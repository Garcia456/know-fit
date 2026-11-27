#!/usr/bin/env node
/**
 * 端到端 —— 休息日 / 待补记录 / 补昨天提示。
 *
 * 两个全新账号，走 HTTP + 裸 SQL：
 *   A. 「昨天练了胸」空抽取 → 下一句无日期补细节 → 落到昨天、split=胸
 *   B. 今天记完、昨天空白 → 返回 backfill 提示 → 点「休息」→ day_status=rest
 *   C. GET /api/day-states 能读回休息日
 *
 * 🔴 假定 server 跑在 fake provider（check-dev.sh 显式设）。本脚本不联网、不需要 key。
 * 用法：node scripts/e2e-dev028.mjs      退出码 0 = 通过
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const RECORD = '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组';

let failed = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = 1;
};

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}

async function call(path, init = {}, cookie = '') {
  const headers = {
    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(cookie ? { cookie } : {}),
  };
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function turn(message, cookie, conversationId) {
  const res = await call(
    '/turns',
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    },
    cookie,
  );
  if (res.status !== 200) {
    bad(`POST /api/turns（${message}）→ HTTP ${res.status} ${JSON.stringify(res.body)}`);
    return null;
  }
  return res.body;
}

async function newAccount(label) {
  // 直接建用户 + 会话，绕开注册 / 登录限流 —— 这条 e2e 验的是补记，不是认证
  const id = randomUUID();
  const email = `e2e-dev028-${label}-${randomUUID()}@knowfit.local`;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await client.query(
    `insert into "user" (id, email, password_hash, nickname, email_verified_at)
     values ($1, $2, 'x', $3, now())`,
    [id, email, `E2E-${label}`],
  );
  await client.query(
    'insert into auth_session (user_id, token_hash, expires_at) values ($1, $2, $3)',
    [id, tokenHash, expiresAt],
  );
  return { id, cookie: `kf_session=${encodeURIComponent(token)}`, email };
}

console.log('\n=== 休息日 / 待补记录 / 补昨天提示 端到端 ===\n');

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
await client.connect();

const users = [];
try {
  // ── A. 提过「昨天练了胸」，下一句无日期补细节 ────────────────────
  console.log('— A. 空抽取保留日期 / 部位，补细节落昨天 —');
  const a = await newAccount('mention');
  if (!a) throw new Error('A 账号没建出来');
  users.push(a.id);

  const first = await turn('昨天练了胸', a.cookie);
  if (first?.card?.kind === 'chat') ok('「昨天练了胸」→ chat（不建训练）');
  else bad(`「昨天练了胸」应为 chat，实为 ${first?.card?.kind}`);

  const second = await turn('卧推做了四组，每组 8 个', a.cookie, first?.conversation_id);
  if (second?.card?.kind === 'workout') {
    if (second.card.date === yesterdayKey()) ok(`补细节落昨天：${second.card.date}`);
    else bad(`补细节日期应为 ${yesterdayKey()}，实为 ${second.card.date}`);
    if (second.card.split_label === '胸') ok('补细节沿用 pending 部位：胸');
    else bad(`补细节部位应为 胸，实为 ${second.card.split_label}`);
  } else {
    bad(`补细节应返回 workout 卡，实为 ${second?.card?.kind}`);
  }

  const aSessions = await client.query(
    'select date::text as date, split_label from workout_session where user_id = $1 order by created_at desc limit 1',
    [a.id],
  );
  const aRow = aSessions.rows[0];
  if (aRow?.date === yesterdayKey() && aRow?.split_label === '胸') {
    ok('裸 SQL：昨天 / 胸 真的落库');
  } else {
    bad(`裸 SQL：期望 ${yesterdayKey()} / 胸，实为 ${JSON.stringify(aRow)}`);
  }

  // ── B. 今天记完、昨天空白 → 补记提示 ─────────────────────────────
  console.log('\n— B. 记录后给昨天空白一个补记提示 —');
  const b = await newAccount('gap');
  if (!b) throw new Error('B 账号没建出来');
  users.push(b.id);

  const recorded = await turn(RECORD, b.cookie);
  if (recorded?.card?.kind === 'workout') ok('今天记录落成 workout 卡');
  else bad(`今天记录应为 workout 卡，实为 ${recorded?.card?.kind}`);

  const prompt = recorded?.backfill;
  if (prompt?.target_date === yesterdayKey() && prompt?.source === 'gap') {
    ok(`补记提示：${prompt.target_date} / gap`);
  } else {
    bad(`补记提示不符：${JSON.stringify(prompt)}`);
  }

  if (prompt?.nudge_id) {
    const action = await call(
      `/nudges/${encodeURIComponent(prompt.nudge_id)}/action`,
      { method: 'POST', body: JSON.stringify({ action: '休息' }) },
      b.cookie,
    );
    if (action.status === 200 && action.body?.ok === true) ok('点「休息」→ 200');
    else bad(`点「休息」→ HTTP ${action.status} ${JSON.stringify(action.body)}`);

    const marks = await client.query(
      'select status from day_status where user_id = $1 and date = $2',
      [b.id, yesterdayKey()],
    );
    if (marks.rows[0]?.status === 'rest') ok('裸 SQL：昨天 day_status=rest');
    else bad(`裸 SQL：day_status 期望 rest，实为 ${JSON.stringify(marks.rows[0])}`);

    const pending = await client.query(
      'select status from pending_record where user_id = $1 and target_date = $2',
      [b.id, yesterdayKey()],
    );
    if (pending.rows[0]?.status === 'rest') ok('裸 SQL：pending_record=rest');
    else bad(`裸 SQL：pending_record 期望 rest，实为 ${JSON.stringify(pending.rows[0])}`);
  } else {
    bad('补记提示没有 nudge_id，无法测动作');
  }

  // ── C. 日历读回四态 ──────────────────────────────────────────────
  console.log('\n— C. GET /api/day-states 读回休息日 —');
  const dayStates = await call(
    `/day-states?from=${yesterdayKey()}&to=${yesterdayKey()}`,
    { method: 'GET' },
    b.cookie,
  );
  if (dayStates.status === 200) {
    const hit = dayStates.body?.days?.find((d) => d.date === yesterdayKey());
    if (hit?.state === 'rest') ok(`day-states 读回 ${yesterdayKey()} = rest`);
    else bad(`day-states 没读回休息日：${JSON.stringify(dayStates.body)}`);
  } else {
    bad(`GET /api/day-states → HTTP ${dayStates.status}`);
  }
} catch (error) {
  bad(error instanceof Error ? error.message : String(error));
} finally {
  if (users.length > 0) {
    await client.query('delete from "user" where id = any($1::uuid[])', [users]).catch(() => {});
  }
  await client.end().catch(() => {});
}

if (failed) {
  console.error('\n端到端失败。');
  process.exit(1);
}
console.log('\n端到端全部通过。');
