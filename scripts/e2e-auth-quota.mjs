#!/usr/bin/env node
/**
 * 端到端 —— 注册邮箱验证 / 免费额度 / 邀请码解锁 / 自带 Key。
 *
 * 用一个全新账号走 HTTP：
 *   1. 先发邮箱验证码；错误验证码 → 400，账号不会创建
 *   2. 正确验证码 → 注册成功且 email_verified=true，/account/ai 额度 0 / 20
 *   3. /turns → 200，免费次数 +1
 *   4. 白名单外模型 → 400，且不发探测；探测失败 → 502，Key 不落库、响应不带明文
 *   5. 错邀请码 → 403；对邀请码 → 解锁；之后 /turns 不再被额度挡，也不扣次数
 *
 * 🔴 假定 server 跑在 fake provider（check-dev.sh 显式设）且 DEEPSEEK_BASE_URL 指向本机
 *    关闭端口 —— 本脚本不联网、不需要真 Key。
 * 用法：node scripts/e2e-auth-quota.mjs      退出码 0 = 通过
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sessionCookieFrom } from './lib/login.mjs';
import { readRegistrationCode } from './lib/register.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const INVITE = process.env.KNOWLEDGE_INVITE_CODE ?? 'dev-knowledge-invite';

const EMAIL = `e2e-auth-quota-${randomUUID()}@knowfit.local`;
const PASSWORD = 'knowfit-e2e-123';
const FAKE_KEY = 'sk-e2e-probe-failure-000000000000';

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
  return { status: res.status, body };
}

console.log('\n=== 邮箱验证 / 额度 / 邀请码 / 自带 Key 端到端 ===\n');

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
await client.connect();

let cookie = '';
let userId = '';

try {
  // ── A. 注册必须先通过邮箱验证码 ──────────────────────────────────
  console.log('— A. 注册邮箱验证 —');
  const sent = await call('/auth/register/code', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL }),
  });
  if (sent.status === 200) ok('POST /api/auth/register/code → 验证码已发送');
  else {
    bad(`发验证码失败：HTTP ${sent.status} ${JSON.stringify(sent.body)}`);
    throw new Error('拿不到验证码，后续步骤没有意义');
  }

  const wrong = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      nickname: 'E2E额度',
      code: '000000',
    }),
  });
  if (wrong.status === 400 && wrong.body?.code === 'register_code_invalid') {
    ok('验证码不对 → 400，不允许完成注册');
  } else {
    bad(`错误验证码应 400 register_code_invalid，实为 ${wrong.status} ${JSON.stringify(wrong.body)}`);
  }

  const beforeRegister = await client.query('SELECT 1 FROM "user" WHERE email = $1', [EMAIL]);
  if (beforeRegister.rowCount === 0) ok('验证码错误时库里没有创建账号');
  else bad('验证码没通过却创建了账号');

  const code = readRegistrationCode(EMAIL);
  if (!code) {
    bad(`outbox 里找不到 ${EMAIL} 的注册验证码（MAIL_OUTBOX_DIR=${process.env.MAIL_OUTBOX_DIR ?? '.mail-outbox'}）`);
    throw new Error('拿不到验证码，后续步骤没有意义');
  }
  ok('从 outbox 读到 6 位注册验证码');

  const reg = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, nickname: 'E2E额度', code }),
  });
  if (reg.status !== 200) {
    bad(`注册失败：HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
    throw new Error('注册没通过，后面的步骤没有意义');
  }
  userId = reg.body.user.id;
  if (reg.body.user.email_verified === true) ok('注册成功且 email_verified=true');
  else bad(`注册后仍显示未验证：${JSON.stringify(reg.body.user.email_verified)}`);

  // 注册响应里也带 Set-Cookie；这里重新登录一次，顺手把登录链路也走一遍
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  cookie = sessionCookieFrom(login);
  ok(`注册并登录：${EMAIL}`);

  const ai = await call('/account/ai', {}, cookie);
  if (ai.status === 200) ok('GET /api/account/ai → 200');
  else bad(`GET /api/account/ai 应 200，实为 ${ai.status}`);
  if (ai.body?.email_verified === true) ok('AI 状态：邮箱已验证');
  else bad(`新账号应已验证，实为 ${JSON.stringify(ai.body?.email_verified)}`);
  if (ai.body?.key === null) ok('AI 状态：没有保存 Key');
  else bad(`新账号不该有 Key：${JSON.stringify(ai.body?.key)}`);
  if (
    ai.body?.quota?.limit === 20 &&
    ai.body?.quota?.used === 0 &&
    ai.body?.quota?.remaining === 20
  ) {
    ok('AI 状态：免费额度 0 / 20');
  } else {
    bad(`额度不对：${JSON.stringify(ai.body?.quota)}`);
  }
  if (Array.isArray(ai.body?.models) && ai.body.models.includes('deepseek-flash')) {
    ok(`模型白名单可读（${ai.body.models.join(' / ')}）`);
  } else {
    bad(`模型白名单不对：${JSON.stringify(ai.body?.models)}`);
  }

  // ── B. 已验证账号可以对话，并扣 1 次免费额度 ─────────────────────
  console.log('\n— B. 免费额度扣减 —');
  const firstTurn = await call(
    '/turns',
    { method: 'POST', body: JSON.stringify({ message: '你好' }) },
    cookie,
  );
  if (firstTurn.status === 200) ok('注册后 /turns → 200');
  else bad(`已验证 /turns 应 200，实为 ${firstTurn.status} ${JSON.stringify(firstTurn.body)}`);

  const afterTurn = await client.query(
    'SELECT free_turns_used FROM "user" WHERE id = $1',
    [userId],
  );
  if (afterTurn.rows[0]?.free_turns_used === 1) ok('免费次数 0 → 1');
  else bad(`免费次数应变成 1，实为 ${JSON.stringify(afterTurn.rows[0])}`);

  // ── C. 自带 Key：校验模型白名单与探测失败路径 ────────────────────
  console.log('\n— C. 自带 Key（不联网，验失败路径） —');
  const badModel = await call(
    '/account/ai/key',
    { method: 'PUT', body: JSON.stringify({ api_key: FAKE_KEY, model: 'gpt-4o' }) },
    cookie,
  );
  if (badModel.status === 400 && badModel.body?.code === 'llm_model_unknown') {
    ok('白名单外模型 → 400 llm_model_unknown');
  } else {
    bad(`白名单外模型应 400，实为 ${badModel.status} ${JSON.stringify(badModel.body)}`);
  }

  const probe = await call(
    '/account/ai/key',
    { method: 'PUT', body: JSON.stringify({ api_key: FAKE_KEY, model: 'deepseek-flash' }) },
    cookie,
  );
  if (probe.status === 502 && probe.body?.code === 'llm_probe_failed') {
    ok('探测不通 → 502 llm_probe_failed（Key 未保存）');
  } else {
    bad(`探测失败应 502 llm_probe_failed，实为 ${probe.status} ${JSON.stringify(probe.body)}`);
  }
  if (!JSON.stringify(probe.body ?? {}).includes(FAKE_KEY)) ok('失败响应里没有明文 Key');
  else bad('失败响应里出现了明文 Key');

  const rows = await client.query('SELECT count(*)::int AS n FROM user_llm_config WHERE user_id = $1', [
    userId,
  ]);
  if (rows.rows[0]?.n === 0) ok('探测失败后库里没有 Key 行');
  else bad(`探测失败却落库了 ${rows.rows[0]?.n} 行`);

  const aiAfterProbe = await call('/account/ai', {}, cookie);
  if (aiAfterProbe.body?.key === null) ok('/account/ai：仍然没有 Key');
  else bad(`探测失败后 key 应为 null：${JSON.stringify(aiAfterProbe.body?.key)}`);

  // ── D. 邀请码：错的拒绝，对的解锁 ────────────────────────────────
  console.log('\n— D. 邀请码解锁 —');
  const wrongInvite = await call(
    '/account/knowledge-access',
    { method: 'POST', body: JSON.stringify({ invite_code: 'definitely-wrong' }) },
    cookie,
  );
  if (wrongInvite.status === 403) ok('错邀请码 → 403');
  else bad(`错邀请码应 403，实为 ${wrongInvite.status} ${JSON.stringify(wrongInvite.body)}`);

  const unlocked = await call(
    '/account/knowledge-access',
    { method: 'POST', body: JSON.stringify({ invite_code: INVITE }) },
    cookie,
  );
  if (unlocked.status === 200 && unlocked.body?.invite_unlocked === true) {
    ok('对邀请码 → 解锁知识库');
  } else {
    bad(`邀请码解锁失败：HTTP ${unlocked.status} ${JSON.stringify(unlocked.body)}`);
  }

  const aiUnlocked = await call('/account/ai', {}, cookie);
  if (aiUnlocked.body?.invite_unlocked === true) ok('/account/ai：invite_unlocked=true');
  else bad(`/account/ai 里未解锁：${JSON.stringify(aiUnlocked.body?.invite_unlocked)}`);

  // ── E. 受邀账号不受额度限制，也不继续扣次数 ──────────────────────
  console.log('\n— E. 解锁后发对话 —');
  const turn = await call('/turns', { method: 'POST', body: JSON.stringify({ message: '你好' }) }, cookie);
  if (turn.status === 200) ok('解邀请码后 /turns → 200');
  else bad(`解锁后 /turns 应 200，实为 ${turn.status} ${JSON.stringify(turn.body)}`);

  const quota = await client.query('SELECT free_turns_used FROM "user" WHERE id = $1', [userId]);
  if (quota.rows[0]?.free_turns_used === 1) ok('受邀账号保留解锁前的 1 次，不再继续扣');
  else bad(`受邀账号免费次数应停在 1，实为 ${quota.rows[0]?.free_turns_used}`);
} catch (e) {
  bad(e instanceof Error ? e.message : String(e));
} finally {
  // 收尾：注销账号（级联删会话 / Key），再删注册验证码留痕
  try {
    if (cookie) await call('/account', { method: 'DELETE' }, cookie);
    if (userId) await client.query('DELETE FROM "user" WHERE id = $1', [userId]);
    await client.query('DELETE FROM registration_verification WHERE email = $1', [EMAIL]);
  } catch {
    console.error(`  ⚠️ 测试账号 ${EMAIL} 没清干净，可手动删除`);
  }
  await client.end().catch(() => {});
}

if (failed) {
  console.error('\n 邮箱验证 / 额度 / 邀请码 / 自带 Key 端到端未通过。\n');
  process.exit(1);
}
console.log('\n 全部通过。\n');
