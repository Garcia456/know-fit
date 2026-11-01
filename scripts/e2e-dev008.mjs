#!/usr/bin/env node
/**
 * 端到端：注册 / 登录态 / 多用户隔离 / 改资料 / 清空训练 / 注销
 *
 * 走 HTTP（vite 代理 → api），再用裸 SQL 验落库：
 *   A. 未登录访问数据接口 → 401
 *   B. 注册即登录；新账号看不到别人的记录（history 为空）
 *   C. 重复邮箱 → 409；错密码 → 401
 *   D. PATCH /account 改昵称 / 生日 / 性别 / 签名；GET /auth/me 回读
 *   E. DELETE /account/training-records 只清训练，档案与体重历史保留
 *   F. DELETE /account 后旧 cookie 失效、user 行消失
 *
 * 自清理：测试账号在 finally 里按邮箱删掉。
 *
 * 用法： node scripts/e2e-dev008.mjs      （先起 pnpm dev）
 * 退出码：0 = 通过；1 = 失败
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sessionCookieFrom } from './lib/login.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';

const EMAIL = `e2e-dev008-${randomUUID()}@knowfit.local`;
const PASSWORD = 'knowfit-e2e-123';

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
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

console.log('\n=== 用户系统端到端 ===\n');

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
let userId;

try {
  await client.connect();
} catch (e) {
  bad(`连不上数据库：${e.message}`);
  process.exit(1);
}

try {
  // A. 未登录不放进数据接口
  const anon = await call('/history');
  if (anon.status === 401) ok('未登录 GET /api/history → 401');
  else bad(`未登录访问应 401，实为 ${anon.status}`);

  // B. 注册即登录
  const reg = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, nickname: 'E2E新人' }),
  });
  if (reg.status === 200 && reg.body?.user?.email === EMAIL) {
    ok(`注册成功：${EMAIL}`);
  } else {
    bad(`注册失败：HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
    throw new Error('注册没通过，后面的步骤没有意义');
  }
  userId = reg.body.user.id;
  const cookie = sessionCookieFrom(reg);

  const me = await call('/auth/me', {}, cookie);
  if (me.status === 200 && me.body?.user?.id === userId) ok('GET /api/auth/me 换回了同一个用户');
  else bad(`GET /api/auth/me 返回 ${me.status} ${JSON.stringify(me.body)}`);

  // 新账号从空白开始 —— 不能看到 demo 的训练记录
  const history = await call('/history', {}, cookie);
  if (history.status === 200 && history.body?.items?.length === 0) {
    ok('新账号的 /api/history 为空（多用户隔离生效）');
  } else {
    bad(`新账号 history 应为空，实为 ${JSON.stringify(history.body).slice(0, 200)}`);
  }

  // C. 重复邮箱 / 错密码
  const dup = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, nickname: '重复' }),
  });
  if (dup.status === 409) ok('重复邮箱注册 → 409');
  else bad(`重复邮箱应 409，实为 ${dup.status}`);

  const badLogin = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'wrong-password' }),
  });
  if (badLogin.status === 401) ok('错密码登录 → 401');
  else bad(`错密码应 401，实为 ${badLogin.status}`);

  // D. 改账号资料
  const patch = await call(
    '/account',
    {
      method: 'PATCH',
      body: JSON.stringify({
        nickname: 'E2E改名',
        birthday: '2000-01-15',
        gender: '男',
        bio: 'E2E 签名',
      }),
    },
    cookie,
  );
  if (
    patch.status === 200 &&
    patch.body?.user?.nickname === 'E2E改名' &&
    patch.body?.user?.gender === '男' &&
    typeof patch.body?.user?.age === 'number'
  ) {
    ok(`改资料回读：${patch.body.user.nickname} / ${patch.body.user.age} 岁 / ${patch.body.user.bio}`);
  } else {
    bad(`改资料失败：HTTP ${patch.status} ${JSON.stringify(patch.body)}`);
  }

  const reread = await call('/auth/me', {}, cookie);
  if (reread.body?.user?.nickname === 'E2E改名' && reread.body?.user?.bio === 'E2E 签名') {
    ok('GET /api/auth/me 与修改一致');
  } else {
    bad(`回读不一致：${JSON.stringify(reread.body?.user)}`);
  }

  // E. 清空训练记录：先造档案、体重、训练、对话
  await client.query(`INSERT INTO user_profile (user_id, height_cm, goal) VALUES ($1, 178, '增肌')`, [
    userId,
  ]);
  await client.query(
    `INSERT INTO body_metric (user_id, date, weight_kg) VALUES ($1, CURRENT_DATE, 72.5)`,
    [userId],
  );
  const session = await client.query(
    `INSERT INTO workout_session (user_id, date, split_label, status)
     VALUES ($1, CURRENT_DATE, 'E2E背日', 'complete') RETURNING id`,
    [userId],
  );
  const sessionId = session.rows[0].id;
  await client.query(
    `INSERT INTO exercise_entry (session_id, "order", raw_name) VALUES ($1, 0, '引体向上')`,
    [sessionId],
  );
  await client.query(
    `INSERT INTO conversation_turn (user_id, role, content) VALUES ($1, 'user', '今天练背')`,
    [userId],
  );
  await client.query(
    `INSERT INTO assessment
       (user_id, trigger, verdict_json, advice_text, advice_claims, has_source,
        model_version, judge_model_version, pipeline_meta)
     VALUES ($1, 'explicit', '{}', '测试建议', '[]', false, 'test', 'test', '{}')`,
    [userId],
  );

  const cleared = await call('/account/training-records', { method: 'DELETE' }, cookie);
  if (
    cleared.status === 200 &&
    cleared.body?.cleared?.sessions === 1 &&
    cleared.body?.cleared?.turns === 1 &&
    cleared.body?.cleared?.assessments === 1
  ) {
    ok(`清空训练记录：${JSON.stringify(cleared.body.cleared)}`);
  } else {
    bad(`清空训练记录失败：HTTP ${cleared.status} ${JSON.stringify(cleared.body)}`);
  }

  const kept = await client.query(
    `SELECT
       (SELECT count(*)::int FROM workout_session WHERE user_id = $1) AS sessions,
       (SELECT count(*)::int FROM user_profile WHERE user_id = $1) AS profiles,
       (SELECT count(*)::int FROM body_metric WHERE user_id = $1) AS weights`,
    [userId],
  );
  const k = kept.rows[0];
  if (k.sessions === 0 && k.profiles === 1 && k.weights === 1) {
    ok('训练清空，档案与体重历史保留');
  } else {
    bad(`清空范围不对：${JSON.stringify(k)}`);
  }

  // F. 注销
  const del = await call('/account', { method: 'DELETE' }, cookie);
  if (del.status === 200) ok('DELETE /api/account → 200');
  else bad(`注销失败：HTTP ${del.status}`);

  const after = await call('/auth/me', {}, cookie);
  if (after.status === 401) ok('注销后旧 cookie → 401');
  else bad(`注销后旧 cookie 应 401，实为 ${after.status}`);

  const gone = await client.query('SELECT 1 FROM "user" WHERE id = $1', [userId]);
  if (gone.rowCount === 0) ok('user 行已删除');
  else bad('user 行还在');
} catch (e) {
  bad(e.message);
} finally {
  // 删除没走完的测试账号（级联带走所有数据）
  try {
    await client.query('DELETE FROM "user" WHERE email LIKE $1', ['e2e-dev008-%']);
  } catch {
    // 连接已坏就交给下次；本脚本不因此加错
  }
  await client.end();
}

if (failed) {
  console.error('\n用户系统端到端未通过。\n');
  process.exit(1);
}
console.log('\n用户系统端到端通过。\n');