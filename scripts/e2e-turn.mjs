#!/usr/bin/env node
/**
 * know-fit 端到端往返
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
 * 两块：
 *   A. 录入往返 —— 3 动作 12 组
 *   B. 容量与数据钩子 —— 容量现算、热身滤掉、环比基线
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
import { loginDemo } from './lib/login.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
// 黄金集里那句「一句话验收」，3 动作 12 组
const MESSAGE = '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组';
// 已知容量 + 带热身（正式 5×100×5 = 2500，两组 40kg×10 热身不算）
const WARMUP_MSG = '推日：卧推先热身两组 40kg×10，然后 100kg×5 五组';
// 同 split 的又一条 —— 环比基线拿上一条当「上一次」（2000 对 2500 → −20%）
const NEXT_MSG = '推日：卧推 80kg×5 五组';
// 基线只认同一个 split —— fixtures 里这两条的 split_label 就是这个标记（理由见 fixtures.ts）
const MARK_SPLIT = '推-e2e';

let failed = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = true;
};

console.log('\n=== know-fit 端到端往返 ===\n');

let cookie;
try {
  cookie = await loginDemo(BASE);
  ok('demo 账号登录成功');
} catch (e) {
  bad(e.message);
  bad('dev server 起了吗？迁移 0009 跑了吗？（demo 账号由它建）');
  process.exit(1);
}

/** 发一轮，返回 body；失败返回 null */
async function post(message) {
  try {
    const res = await fetch(`${BASE}/api/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      bad(`POST ${BASE}/api/turns → HTTP ${res.status}`);
      console.error(`     ${(await res.text()).slice(0, 500)}`);
      return null;
    }
    ok(`POST /api/turns → 200（${message.slice(0, 12)}…）`);
    return await res.json();
  } catch (e) {
    bad(`请求发不出去：${e.message}`);
    bad('  dev server 起了吗？（pnpm dev）');
    return null;
  }
}

const created = []; // 本次落下的 session_id —— 收尾全删

// ── A. 录入往返 ──────────────────────────────────────────────────────
console.log('\n— A. 录入往返 —');

const body = await post(MESSAGE);
const sessionId = body?.card?.kind === 'workout' ? body.card.session_id : null;
if (sessionId) created.push(sessionId);

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
    // 歧义动作不强行归并
    const fly = card.exercises.find((e) => e.raw_name === '飞鸟');
    if (fly && fly.exercise_id === null) ok('「飞鸟」exercise_id 为 null（不强行归并）');
    else bad(`「飞鸟」的 exercise_id 应为 null，实为 ${JSON.stringify(fly?.exercise_id)}`);
  }
}

// ── B. 容量与数据钩子 ────────────────────────────────────────────────
console.log('\n— B. 容量与数据钩子 —');

// B1：先落一条带热身的已知记录 —— 钩子必须出现，且容量只算正式组
const first = await post(WARMUP_MSG);
const firstId = first?.card?.kind === 'workout' ? first.card.session_id : null;
if (firstId) created.push(firstId);

if (first?.card?.kind === 'workout') {
  const h = first.card.hook;
  if (!h) {
    bad('卡片没带数据钩子 —— 记录完成后必须带');
  } else {
    if (h.metric === 'volume' && h.current === 2500) {
      ok(`钩子带的是算好的容量：2500kg（两组 40kg×10 热身已滤掉）`);
    } else {
      bad(`钩子容量应为 2500，实为 ${h.current}（metric ${h.metric}）`);
    }
    // 库里没有更早的同 split 记录 —— 钩子仍出现，只是不带数字
    if (h.baseline === null && h.delta_pct === null) {
      ok('无历史：钩子照样出现，只是不带基线数字');
    } else {
      bad(`无历史时基线应为 null，实为 baseline=${h.baseline} delta=${h.delta_pct}`);
    }
  }
} else if (first) {
  bad(`WARMUP_MSG 的卡片应为 workout，实为 ${JSON.stringify(first.card?.kind)}`);
}

// B1b：容量读路由 —— 现算的容量与肌群分摊
if (firstId) {
  try {
    const res = await fetch(`${BASE}/api/sessions/${firstId}/volume`, { headers: { cookie } });
    const v = res.ok ? await res.json() : null;
    if (v?.total_volume_kg === 2500 && v?.working_sets === 5 && v?.warmup_sets === 2) {
      ok(`GET /api/sessions/:id/volume → 2500kg（正式 5 组 / 热身 2 组）`);
    } else {
      bad(`容量读路由返回 ${JSON.stringify(v)} —— 应为 2500 / 5 / 2`);
    }
    if (v?.by_muscle?.chest === 2500) ok('肌群分摊：胸 2500（主动肌 1.0）');
    else bad(`胸的训练量应为 2500，实为 ${v?.by_muscle?.chest}`);
  } catch (e) {
    bad(`容量读路由请求失败：${e.message}`);
  }
}

// B2：同一 split 再落一条 —— 环比基线取上一条，算出 −20%
const second = await post(NEXT_MSG);
const secondId = second?.card?.kind === 'workout' ? second.card.session_id : null;
if (secondId) created.push(secondId);

if (second?.card?.kind === 'workout') {
  const h = second.card.hook;
  if (h?.current === 2000 && h?.baseline === 2500 && h?.delta_pct === -20) {
    ok(`环比：2000 对上一次 2500 → ${h.delta_pct}%（${h.baseline_kind}）`);
  } else {
    bad(`环比应为 2000 / 2500 / −20，实为 ${h?.current} / ${h?.baseline} / ${h?.delta_pct}`);
  }
  if (h?.scope?.split_label === MARK_SPLIT) ok(`基线口径落在同一个 split（${MARK_SPLIT}）`);
  else bad(`钩子的 split 应为 ${MARK_SPLIT}，实为 ${JSON.stringify(h?.scope?.split_label)}`);
} else if (second) {
  bad(`NEXT_MSG 的卡片应为 workout，实为 ${JSON.stringify(second.card?.kind)}`);
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

  // 容量那条的组：库里应是 7 组（2 热身 + 5 正式），现算时才滤热身
  if (firstId) {
    const n = await client.query(
      'SELECT count(*)::int AS n FROM set_entry e JOIN exercise_entry x ON x.id = e.exercise_entry_id WHERE x.session_id = $1',
      [firstId],
    );
    if (n.rows[0].n === 7) ok('库里 7 条 set_entry（2 热身 + 5 正式，热身是查询时才滤）');
    else bad(`容量那条应有 7 条 set_entry，实为 ${n.rows[0].n}`);
  }

  // 收尾：本次产生的行全删（测试不该在开发库里留痕）
  for (const id of created) {
    await client.query('DELETE FROM conversation_turn WHERE linked_record_id = $1', [id]);
    await client.query('DELETE FROM workout_session WHERE id = $1', [id]);
  }
} finally {
  await client.end();
}

if (failed) {
  console.error('\n端到端往返未通过。\n');
  process.exit(1);
}
console.log('\n端到端往返通过。\n');