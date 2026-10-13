#!/usr/bin/env node
/**
 * know-fit 端到端往返（dev-002 §三 3.1）
 *
 * 一句话：**经由 HTTP 说一句训练，看它有没有变成一条训练记录。**
 *
 *   POST /api/turns（vite 代理 → api 的 POST /turns）
 *     → 断言 200 + 卡片结构
 *     → 再用裸 SQL 断言库里真有这条 workout_session
 *     → 删掉本次产生的行
 *
 * 为什么必须走 HTTP 而不是直接调 handleTurn：
 *   直接调图只能证明「图对」，证明不了「路由挂上了、代理转对了、应答契约对得上」——
 *   这三样恰恰是「本地跑得起来」最容易断的地方。
 *
 * 🔴 不含任何 key：本脚本假定 server 跑在 LLM_PROVIDER=fake 上 ——
 *    check-dev.sh 会显式设它；**手工跑时请自己确认**（脚本无法从应答里看出 provider，
 *    /health 目前不报这个字段）。
 *    在真 provider 上跑会真的花钱。
 *
 * 用法： node scripts/e2e-turn.mjs      （先起 pnpm dev）
 * 退出码：0 = 通过；1 = 失败
 */
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
// 黄金集里那句「一句话验收」，3 动作 12 组
const MESSAGE = '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组';

let failed = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = true;
};

console.log('\n=== know-fit 端到端往返 ===\n');

let body;
try {
  const res = await fetch(`${BASE}/api/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: MESSAGE }),
  });
  if (!res.ok) {
    bad(`POST ${BASE}/api/turns → HTTP ${res.status}`);
    console.error(`     ${(await res.text()).slice(0, 500)}`);
  } else {
    body = await res.json();
    ok(`POST /api/turns → 200`);
  }
} catch (e) {
  bad(`请求发不出去：${e.message}`);
  bad('  dev server 起了吗？（pnpm dev）');
}

const sessionId = body?.card?.kind === 'workout' ? body.card.session_id : null;

if (body) {
  if (typeof body.turn_id === 'string' && /^[0-9a-f-]{36}$/.test(body.turn_id)) {
    ok(`turn_id = ${body.turn_id}`);
  } else {
    bad(`turn_id 不是 uuid：${JSON.stringify(body.turn_id)}`);
  }

  if (body.intent !== 'record') bad(`intent 应为 record，实为 ${body.intent}`);
  else ok('intent = record');

  const card = body.card;
  if (card?.kind !== 'workout') {
    bad(`卡片应为 workout，实为 ${JSON.stringify(card?.kind)}`);
  } else {
    const sets = card.exercises.flatMap((e) => e.sets);
    if (card.exercises.length === 3 && sets.length === 12) {
      ok(`卡片：3 个动作 / 12 组，status = ${card.status}`);
    } else {
      bad(`卡片动作数 ${card.exercises.length}、组数 ${sets.length} —— 应为 3 / 12`);
    }
    // 歧义动作不强行归并（PRD §8.1）
    const fly = card.exercises.find((e) => e.raw_name === '飞鸟');
    if (fly && fly.exercise_id === null) ok('「飞鸟」exercise_id 为 null（不强行归并）');
    else bad(`「飞鸟」的 exercise_id 应为 null，实为 ${JSON.stringify(fly?.exercise_id)}`);
  }
}

// ── 库里真有这条记录吗（读回用裸 SQL，不借 ORM） ─────────────────────
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
} catch (e) {
  bad(`连不上数据库：${e.message}`);
  console.error('     起库：pnpm db:up');
  process.exit(1);
}

try {
  if (sessionId) {
    const s = await client.query(
      "SELECT to_char(date, 'YYYY-MM-DD') AS date, status FROM workout_session WHERE id = $1",
      [sessionId],
    );
    if (s.rowCount === 1) {
      ok(`库里查到了 workout_session（${s.rows[0].date}，${s.rows[0].status}）`);
      const n = await client.query(
        'SELECT count(*)::int AS n FROM set_entry e JOIN exercise_entry x ON x.id = e.exercise_entry_id WHERE x.session_id = $1',
        [sessionId],
      );
      if (n.rows[0].n === 12) ok(`库里 12 条 set_entry`);
      else bad(`库里 set_entry 有 ${n.rows[0].n} 条 —— 应为 12`);
    } else {
      bad(`库里没有 session_id = ${sessionId} 的 workout_session`);
    }

    const t = await client.query(
      'SELECT count(*)::int AS n FROM conversation_turn WHERE linked_record_id = $1',
      [sessionId],
    );
    if (t.rows[0].n >= 1) ok('对话轮次挂在这条记录上（linked_record_id）');
    else bad('conversation_turn 没有指向这条记录');
  }

  // 收尾：本次产生的行全删（测试不该在开发库里留痕）
  if (sessionId) {
    await client.query('DELETE FROM conversation_turn WHERE linked_record_id = $1', [sessionId]);
    await client.query('DELETE FROM workout_session WHERE id = $1', [sessionId]);
  }
} finally {
  await client.end();
}

if (failed) {
  console.error('\n端到端往返未通过。\n');
  process.exit(1);
}
console.log('\n端到端往返通过。\n');