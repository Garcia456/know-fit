#!/usr/bin/env node
/**
 * dev-013 端到端：开放注册 / 限流 / 安全响应头。
 *
 * 单独起一个 NODE_ENV=production 的 API（端口 3101），用小额度把 429 逼出来；
 * 不碰 check-dev 起的 3000 进程，也不依赖它。
 *
 * 用法： node --env-file-if-exists=.env scripts/e2e-dev013.mjs
 * 退出码：0 = 通过；1 = 失败
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { registerWithCode } from './lib/register.mjs';

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const OUTBOX_DIR = resolve(process.env.MAIL_OUTBOX_DIR ?? '.mail-outbox');
const STAMP = Date.now();
const EMAILS = [
  `dev013-a-${STAMP}@example.com`,
  `dev013-b-${STAMP}@example.com`,
  `dev013-c-${STAMP}@example.com`,
];
const PASSWORD = 'dev013-pass-123';

let failed = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed += 1;
};

function demoPassword() {
  if (!existsSync('.demo-accounts.json')) return 'knowfit-demo';
  try {
    const parsed = JSON.parse(readFileSync('.demo-accounts.json', 'utf8'));
    return parsed?.accounts?.['demo@knowfit.local']?.password ?? 'knowfit-demo';
  } catch {
    return 'knowfit-demo';
  }
}

async function post(path, body, cookie, ip) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      // 生产模式 trustProxy 开启，换一个来源 IP 避开上面已经打满的登录桶
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function waitForApi() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      // 还没起来
    }
    await sleep(500);
  }
  return false;
}

const child = spawn(
  process.execPath,
  ['--env-file-if-exists=../../.env', '--import', 'tsx', 'src/server.ts'],
  {
    cwd: 'apps/api',
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'production',
      COOKIE_SECURE: '0',
      // 小额度：几发就能撞到 429
      RATE_LIMIT_LOGIN_PER_15MIN: '3',
      RATE_LIMIT_REGISTER_PER_HOUR: '4',
      // 三次注册各要一次验证码；给足发码桶，别让 429 来自错误的路径
      RATE_LIMIT_REGISTER_CODE_PER_HOUR: '10',
      // 验证码从 outbox 读：生产模式下也强制 fake 投递，保证脚本自洽
      MAIL_PROVIDER: 'fake',
      MAIL_OUTBOX_DIR: OUTBOX_DIR,
      TURN_QUOTA_PER_HOUR: '1',
      ASSESSMENT_QUOTA_PER_HOUR: '1',
      LLM_PROVIDER: 'fake',
      EMBEDDING_PROVIDER: 'fake',
      RERANK_PROVIDER: 'fake',
      LOG_LEVEL: 'silent',
    },
    stdio: 'ignore',
  },
);

let db;
try {
  console.log('\n=== dev-013 开放注册 / 限流 / 安全头 ===\n');

  if (!(await waitForApi())) {
    bad(`API 没起来（端口 ${PORT} 被占用？）`);
    process.exitCode = 1;
  } else {
    // 1. 安全头
    const health = await fetch(`${BASE}/health`);
    const checks = {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'",
    };
    for (const [name, expected] of Object.entries(checks)) {
      const value = health.headers.get(name) ?? '';
      if (value.includes(expected)) ok(`安全头 ${name}: ${value}`);
      else bad(`安全头 ${name} 缺失或不对（拿到「${value}」）`);
    }

    // 2. 开放注册：不带邀请码，但要先完成邮箱验证码
    const [first, second, third] = EMAILS;
    const created = await registerWithCode(
      BASE,
      { email: first, password: PASSWORD, nickname: 'dev013' },
      { outboxDir: OUTBOX_DIR },
    );
    if (created.status === 200) ok('邮箱验证码 + 不带邀请码 → 注册成功');
    else {
      bad(
        `注册应 200，实际 ${created.status}（${created.stage}）：${JSON.stringify(created.body)}`,
      );
    }

    const duplicate = await post('/auth/register', {
      email: first,
      password: PASSWORD,
      nickname: 'dev013',
      code: '000000',
    });
    if (duplicate.status === 409) ok('重复邮箱 → 409');
    else bad(`重复邮箱应 409，实际 ${duplicate.status}`);

    // 3. 注册限流（已用 2 次；补 2 次后第 5 次该拦）
    const secondRes = await registerWithCode(
      BASE,
      { email: second, password: PASSWORD, nickname: 'dev013' },
      { outboxDir: OUTBOX_DIR },
    );
    if (secondRes.status === 200) ok('第二个账号 → 注册成功');
    else {
      bad(
        `第二个账号应 200，实际 ${secondRes.status}（${secondRes.stage}）：${JSON.stringify(secondRes.body)}`,
      );
    }

    const thirdRes = await registerWithCode(
      BASE,
      { email: third, password: PASSWORD, nickname: 'dev013' },
      { outboxDir: OUTBOX_DIR },
    );
    if (thirdRes.status === 200) ok('第三个账号 → 注册成功');
    else {
      bad(
        `第三个账号应 200，实际 ${thirdRes.status}（${thirdRes.stage}）：${JSON.stringify(thirdRes.body)}`,
      );
    }

    const registerLimited = await post('/auth/register', {
      email: `dev013-d-${STAMP}@example.com`,
      password: PASSWORD,
      nickname: 'dev013',
      code: '000000',
    });
    if (registerLimited.status === 429 && registerLimited.headers.get('retry-after')) {
      ok(`注册超限 → 429 + Retry-After ${registerLimited.headers.get('retry-after')}s`);
    } else {
      bad(`注册超限应 429，实际 ${registerLimited.status}`);
    }

    // 4. 登录限流（3 次错密码后第 4 次该拦）
    for (let i = 0; i < 3; i += 1) {
      const res = await post('/auth/login', { email: first, password: 'wrong-password' });
      if (res.status !== 401) bad(`第 ${i + 1} 次错密码应 401，实际 ${res.status}`);
    }
    const loginLimited = await post('/auth/login', { email: first, password: 'wrong-password' });
    if (loginLimited.status === 429 && loginLimited.headers.get('retry-after')) {
      ok(`登录超限 → 429 + Retry-After ${loginLimited.headers.get('retry-after')}s`);
    } else {
      bad(`登录超限应 429，实际 ${loginLimited.status}`);
    }

    // 5. 用户配额：登录 demo 后连发两次空 body（第一次 400 也计数，第二次 429）
    const login = await post(
      '/auth/login',
      { email: 'demo@knowfit.local', password: demoPassword() },
      undefined,
      '10.13.13.13',
    );
    const setCookie = login.headers.getSetCookie?.() ?? [];
    const cookie = (setCookie[0] ?? login.headers.get('set-cookie') ?? '').split(';')[0];
    if (login.status === 200 && cookie) {
      const firstTurn = await post('/turns', {}, cookie);
      if (firstTurn.status === 400) ok('第一次 /turns 通过限流（路由自己回 400）');
      else bad(`第一次 /turns 应 400，实际 ${firstTurn.status}`);

      const secondTurn = await post('/turns', {}, cookie);
      if (secondTurn.status === 429 && secondTurn.headers.get('retry-after')) {
        ok(`/turns 用户配额 → 429 + Retry-After ${secondTurn.headers.get('retry-after')}s`);
      } else {
        bad(`/turns 第二次应 429，实际 ${secondTurn.status}`);
      }
    } else {
      bad(`demo 登录失败（${login.status}）—— .demo-accounts.json 与库里的密码对不上？`);
    }
  }
} finally {
  child.kill();

  // 清掉本次注册的测试账号（级联删会话）
  if (!failed) {
    const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
    db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await db.connect();
      await db.query(`DELETE FROM "user" WHERE email = ANY($1)`, [EMAILS]);
      await db.query('DELETE FROM registration_verification WHERE email LIKE $1', [
        `dev013-%${STAMP}@example.com`,
      ]);
    } catch {
      // 清理失败不影响结论，只提示
      console.error(`  ⚠️ 测试账号 ${EMAILS.join(', ')} 没清掉，可手动删除`);
    } finally {
      await db?.end().catch(() => {});
    }
  }
}

if (failed) {
  console.error(`\n  ${failed} 项未通过。\n`);
  process.exit(1);
}
console.log('\n  全部通过。\n');
