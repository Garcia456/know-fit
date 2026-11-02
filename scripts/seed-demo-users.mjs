#!/usr/bin/env node
/**
 * 建 / 更新三个 demo 账号，并给每个账号加抖音检索授权。
 *
 * - 密码只在首次运行（或 --rotate）生成，写进 .demo-accounts.json（已 gitignore，0600）；
 * - 重复运行幂等：不动昵称与训练数据，只同步密码哈希；
 * - 真实密码不进仓库 / 迁移 / 镜像 / 文档。
 *
 * 用法： pnpm demo:seed
 *        pnpm demo:seed:rotate     # 重新生成三个密码
 *        node scripts/seed-demo-users.mjs --revoke-sessions
 *        DEMO_CREDENTIALS_FILE=/data/.demo-accounts.json node ...
 * 退出码：0 = 成功；1 = 失败
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCallback);
const CREDENTIALS_FILE = process.env.DEMO_CREDENTIALS_FILE ?? '.demo-accounts.json';
const ROTATE = process.argv.includes('--rotate');
/** 换固定密码后强制踢掉旧会话；日常重跑不踢 */
const REVOKE = ROTATE || process.argv.includes('--revoke-sessions');
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

const ACCOUNTS = [
  { email: 'demo@knowfit.local', nickname: 'Garcia' },
  { email: 'demo2@knowfit.local', nickname: 'Demo 2' },
  { email: 'demo3@knowfit.local', nickname: 'Demo 3' },
];

const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';

function newPassword() {
  // 16 个 URL 安全字符，够受控演示用
  return randomBytes(12).toString('base64url');
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function readExisting() {
  if (!existsSync(CREDENTIALS_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'));
    return parsed?.accounts ?? {};
  } catch (e) {
    console.error(`  ✗ 读不了 ${CREDENTIALS_FILE}：${e.message}`);
    console.error('    修好或删掉它再跑；不会自动覆盖，免得把正在用的密码弄丢。');
    process.exit(1);
  }
}

const existing = readExisting();
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });

try {
  await client.connect();
} catch (e) {
  console.error(`  ✗ 连不上数据库（${url.replace(/:[^:@]*@/, ':***@')}）`);
  console.error(`    ${e.message}`);
  console.error('    本地数据库要先起：pnpm db:up && pnpm db:migrate');
  process.exit(1);
}

/** email → { password, nickname } */
const result = {};

try {
  await client.query('BEGIN');

  for (const account of ACCOUNTS) {
    const previous = existing[account.email]?.password;
    const password = ROTATE || !previous ? newPassword() : previous;
    const passwordHash = await hashPassword(password);

    const upsert = await client.query(
      `INSERT INTO "user" (email, password_hash, nickname)
       VALUES ($1, $2, $3)
       ON CONFLICT (email)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
       RETURNING id`,
      [account.email, passwordHash, account.nickname],
    );
    const userId = upsert.rows[0].id;

    // 换密码时把旧会话一并掐掉，免得泄露的 session 还能继续用
    if (REVOKE || !previous) {
      await client.query('DELETE FROM auth_session WHERE user_id = $1', [userId]);
    }

    await client.query(
      `INSERT INTO knowledge_access (user_id, platform)
       VALUES ($1, 'douyin')
       ON CONFLICT (user_id, platform) DO NOTHING`,
      [userId],
    );

    result[account.email] = { password, nickname: account.nickname };
  }

  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`  ✗ 写库失败：${e.message}`);
  console.error('    迁移跑了吗？pnpm db:migrate');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

if (process.exitCode) process.exit(process.exitCode);

mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true });
writeFileSync(
  CREDENTIALS_FILE,
  JSON.stringify({ generated_at: new Date().toISOString(), accounts: result }, null, 2) + '\n',
  { mode: 0o600 },
);
try {
  chmodSync(CREDENTIALS_FILE, 0o600);
} catch {
  // Windows 上 chmod 基本是空操作，文件已经 gitignore
}

console.log('\n=== demo 账号已就绪（三个都有 douyin 检索授权）===\n');
for (const [email, { password }] of Object.entries(result)) {
  console.log(`  ${email.padEnd(26)} ${password}`);
}
console.log(`\n  凭据已写入 ${CREDENTIALS_FILE}（已 gitignore，勿提交）`);
console.log('  轮换密码：pnpm demo:seed:rotate\n');