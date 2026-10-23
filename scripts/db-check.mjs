#!/usr/bin/env node
/**
 * know-fit 数据库可达性断言
 *
 * 断言五件事：
 *   1. `vector` 扩展已安装（查 pg_extension 的 extversion 有值）
 *   2. 能建 `vector(1024)` 列 + HNSW（cosine）索引 —— 建完即回滚
 *   3. 录入链路的 6 张记录表都建出来了（迁移跑没跑）
 *   4. v1 单用户的固定锚点行还在（没有它，任何落库都会撞外键）
 *   5. 知识库两张表建出来了（采集落 knowledge_source，切片落 knowledge_chunk）
 *   6. knowledge_chunk 上真有 HNSW（cosine）索引 —— 检索侧就靠它
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

  // 5. 知识库两张表 —— 采集 / 切片各自落库的目标；缺了它们管线会在落库那一刻才炸
  const kb = await client.query(
    "SELECT table_name, count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('knowledge_source', 'knowledge_chunk') GROUP BY table_name",
  );
  const columns = new Map(kb.rows.map((r) => [r.table_name, r.n]));
  const missingKb = ['knowledge_source', 'knowledge_chunk'].filter((t) => !columns.has(t));
  if (missingKb.length > 0) {
    bad(`知识库表不在：${missingKb.join('、')} —— 0003 / 0004 迁移没跑：pnpm db:migrate`);
  } else {
    ok(`知识库两张表都在（knowledge_source ${columns.get('knowledge_source')} 列 / knowledge_chunk ${columns.get('knowledge_chunk')} 列）`);
  }

  // 6. HNSW 索引 —— 第 2 条只证明「本机建得起来」，这条证明「迁移真把索引建在表上了」
  const hnsw = await client.query(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'knowledge_chunk'
        AND indexname = 'knowledge_chunk_embedding_hnsw'`,
  );
  if (
    hnsw.rowCount === 1 &&
    /hnsw/i.test(hnsw.rows[0].indexdef) &&
    /vector_cosine_ops/i.test(hnsw.rows[0].indexdef)
  ) {
    ok('knowledge_chunk 上有 HNSW（cosine）索引');
  } else {
    bad('knowledge_chunk 上缺 HNSW（cosine）索引 —— 0004 迁移没跑：pnpm db:migrate');
  }
} finally {
  await client.end();
}

if (failed) {
  console.error('\n数据库检查未通过。\n');
  process.exit(1);
}
console.log('\n数据库检查通过。\n');