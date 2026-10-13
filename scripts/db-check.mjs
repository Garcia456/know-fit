#!/usr/bin/env node
/**
 * know-fit 数据库可达性断言
 *
 * 断言四件事：
 *   1. `vector` 扩展已安装（查 pg_extension 的 extversion 有值）
 *   2. 能建 `vector(1024)` 列 + HNSW（cosine）索引 —— 建完即回滚
 *   3. 录入链路的 6 张记录表都建出来了（迁移跑没跑）
 *   4. v1 单用户的固定锚点行还在（没有它，任何落库都会撞外键）
 *
 * 为什么第 2 条不能省：第 1 条只证明「扩展装上了」，
 * 而项目真正依赖的是 HNSW 索引能不能建 ——
 * 装不上，后面的检索侧就整个停摆。
 *
 * 用法： pnpm db:check        （根 package.json 已带 --env-file-if-exists=.env）
 * 退出码：0 = 通过；1 = 失败
 */
import pg from 'pg';

// 默认值与 docker-compose.yml / apps/api/drizzle.config.ts / apps/api/src/db/client.ts 一致 ——
// 「克隆即跑」不该先要求配 .env。
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
let failed = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = true;
};

console.log('\n=== know-fit 数据库检查 ===\n');

try {
  await client.connect();
} catch (e) {
  console.error(`  \x1b[31m✗\x1b[0m 连不上数据库（${url.replace(/:[^:@]*@/, ':***@')}）`);
  console.error(`     ${e.message}`);
  console.error('     本地数据库要先起：pnpm db:up');
  process.exit(1);
}

try {
  // 1. vector 扩展
  const ext = await client.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (ext.rowCount === 0) {
    bad("vector 扩展未安装 —— 镜像 tag 选错了吗？（应为 pgvector/pgvector:*）");
  } else {
    ok(`vector 扩展已安装（版本 ${ext.rows[0].extversion}）`);
  }

  // 2. 能建 vector(1024) 列 + HNSW cosine 索引（建完即回滚）
  if (!failed) {
    try {
      await client.query('BEGIN');
      await client.query(
        'CREATE TEMP TABLE _knowfit_smoke (id int, embedding vector(1024)) ON COMMIT DROP',
      );
      await client.query(
        'CREATE INDEX _knowfit_smoke_hnsw ON _knowfit_smoke USING hnsw (embedding vector_cosine_ops)',
      );
      await client.query('ROLLBACK');
      ok('能建 vector(1024) 列 + HNSW（cosine）索引（已回滚）');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      bad(`建 HNSW 索引失败：${e.message}`);
      bad('  若报 shared memory 相关错误 → 调大 docker-compose.yml 的 shm_size');
    }
  }

  // 3. 录入链路的 6 张表 —— 迁移没跑时这条最先炸，比路由报错好读
  const TABLES = [
    'user',
    'user_profile',
    'workout_session',
    'exercise_entry',
    'set_entry',
    'conversation_turn',
  ];
  const found = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)",
    [TABLES],
  );
  const have = new Set(found.rows.map((r) => r.tablename));
  const missing = TABLES.filter((t) => !have.has(t));
  if (missing.length > 0) {
    bad(`缺表：${missing.join('、')} —— 迁移没跑：pnpm db:migrate`);
  } else {
    ok(`录入链路的 6 张记录表都在`);
  }

  // 4. 单用户锚点 —— v1 没有注册流程，缺了它所有落库都会撞外键
  const anchor = await client.query(
    "SELECT id FROM \"user\" WHERE id = '00000000-0000-4000-8000-000000000001'",
  );
  if (anchor.rowCount === 0) {
    bad('单用户锚点行不在 —— 0002 迁移末尾那两行手写 INSERT 丢了吗？');
  } else {
    ok('单用户锚点行在');
  }
} finally {
  await client.end();
}

if (failed) {
  console.error('\n数据库检查未通过。\n');
  process.exit(1);
}
console.log('\n数据库检查通过。\n');