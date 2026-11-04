#!/usr/bin/env node
/**
 * 端到端 —— 区间容量查询与无数据如实回答。
 *
 * 用一个全新的空账号走 HTTP：
 *   1. 「上周容量怎么样」→ chat 实话「没有训练记录」，不落「没听清是哪天」
 *   2. 记一次今天的训练
 *   3. 「本周容量」→ 天数 / 总容量 / 正式组数与记录一致
 *   4. 同一账号再问「上周」→ 仍如实说没有（今天的记录不在上周）
 *
 * 🔴 假定 server 跑在 fake provider（check-dev.sh 显式设）。本脚本不联网、不需要 key。
 * 用法：node scripts/e2e-dev018.mjs      退出码 0 = 通过
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sessionCookieFrom } from './lib/login.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';

const EMAIL = `e2e-dev018-${randomUUID()}@knowfit.local`;
const PASSWORD = 'knowfit-e2e-123';
const RECORD = '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组';

let failed = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = 1;
};

async function call(path, init = {}, cookie = '') {
  const headers = {
    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(cookie ? { cookie } : {}),
  };
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
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

function expectChatNoRecords(body, label) {
  if (body?.intent !== 'query') {
    bad(`${label}：应为 query，实为 ${body?.intent}`);
    return;
  }
  const card = body.card;
  if (card?.kind !== 'chat') {
    bad(`${label}：应为 chat 卡，实为 ${card?.kind}`);
    return;
  }
  if (card.reply.includes('没有训练记录')) ok(`${label}：如实说没有记录 —— ${card.reply}`);
  else bad(`${label}：没有如实说无数据 —— ${card.reply}`);
  if (!card.reply.includes('没听清')) ok(`${label}：没有回「没听清是哪天」`);
  else bad(`${label}：仍落进日期没听清 —— ${card.reply}`);
}

console.log('\n=== 区间容量查询与无数据如实回答 端到端 ===\n');

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
await client.connect();

let cookie = '';
let userId;

try {
  // ── A. 空账号问上周容量 ──────────────────────────────────────────
  console.log('— A. 空账号问「上周容量怎么样」 —');
  const reg = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      nickname: 'E2E容量',
      ...(process.env.E2E_INVITE_CODE ? { invite_code: process.env.E2E_INVITE_CODE } : {}),
    }),
  });
  if (reg.status !== 200) {
    bad(`注册失败：HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
    throw new Error('注册没通过，后面的步骤没有意义');
  }
  userId = reg.body.user.id;
  cookie = sessionCookieFrom(reg);
  ok(`注册空账号：${EMAIL}`);

  const empty = await turn('上周容量怎么样', cookie);
  if (empty) {
    expectChatNoRecords(empty, '上周容量');
    if (empty.card?.reply?.includes('上周')) ok('回答里点明了「上周」');
    else bad(`回答没点明区间：${empty.card?.reply}`);
  }
  const conversationId = empty?.conversation_id;

  // ── B. 记一次今天的训练 ──────────────────────────────────────────
  console.log('\n— B. 记一次今天的训练 —');
  const recorded = await turn(RECORD, cookie, conversationId);
  if (recorded?.intent === 'record') ok(`「${RECORD.slice(0, 12)}…」→ intent=record`);
  else bad(`应记为 record，实为 ${recorded?.intent}`);

  // ── C. 本周容量 → 与记录一致 ─────────────────────────────────────
  console.log('\n— C. 本周容量 → 天数 / 容量 / 正式组数 —');
  const thisWeek = await turn('本周容量', cookie, conversationId);
  if (thisWeek?.intent !== 'query') {
    bad(`「本周容量」应为 query，实为 ${thisWeek?.intent}`);
  } else if (thisWeek.card?.kind !== 'chat') {
    bad(`「本周容量」应为 chat 卡，实为 ${thisWeek.card?.kind}`);
  } else {
    const reply = thisWeek.card.reply;
    if (reply.includes('练了 1 天')) ok('练了 1 天');
    else bad(`天数不对：${reply}`);
    if (reply.includes('5280kg')) ok('总容量 5280kg');
    else bad(`容量不对：${reply}`);
    if (reply.includes('12 个正式组')) ok('12 个正式组');
    else bad(`正式组数不对：${reply}`);
    if (!reply.includes('没听清')) ok('没有回「没听清是哪天」');
    else bad(`仍落进日期没听清：${reply}`);
  }

  // ── D. 今天的记录不在上周 → 上周仍应如实说没有 ──────────────────
  console.log('\n— D. 再问上周 → 仍如实说没有 —');
  const lastWeek = await turn('上周容量怎么样', cookie, conversationId);
  if (lastWeek) expectChatNoRecords(lastWeek, '有记录后的上周');

  // ── E. 库里真有这条记录 ─────────────────────────────────────────
  console.log('\n— E. 落库核对 —');
  const rows = await client.query(
    `SELECT count(*)::int AS sessions FROM workout_session WHERE user_id = $1`,
    [userId],
  );
  if (rows.rows[0]?.sessions === 1) ok('workout_session 里 1 条记录');
  else bad(`库里记录数不对：${JSON.stringify(rows.rows[0])}`);
} catch (e) {
  bad(e instanceof Error ? e.message : String(e));
} finally {
  try {
    if (cookie) await call('/account', { method: 'DELETE' }, cookie);
    await client.query('DELETE FROM "user" WHERE email LIKE $1', ['e2e-dev018-%']);
  } catch {
    // 连接已坏就交给下次；本脚本不因此加错
  }
  await client.end();
}

if (failed) {
  console.error('\n\x1b[31m区间容量查询端到端未通过。\x1b[0m\n');
  process.exit(1);
}
console.log('\n\x1b[32m区间容量查询端到端全部通过。\x1b[0m\n');