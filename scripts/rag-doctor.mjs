#!/usr/bin/env node
/**
 * 知识检索体检 —— 只读，不改库。
 *
 * 回答一个问题：为什么知识问答没有引用？
 * 依次看 provider 配置、知识库行数、向量模型版本、账号授权。
 *
 * 用法（本地）：node --env-file-if-exists=.env scripts/rag-doctor.mjs
 * 用法（服务器）：bash scripts/rag-doctor.sh
 * 退出码：0 = 没发现明显断点；1 = 发现断点（看 ✗ 行）
 */
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const expectedModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-v4';
const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'fake';
const rerankProvider = process.env.RERANK_PROVIDER || 'fake';

let failed = false;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failed = true;
  console.log(`  ✗ ${msg}`);
};
const info = (msg) => console.log(`    ${msg}`);

console.log('\n== provider ==');
info(`LLM_PROVIDER=${process.env.LLM_PROVIDER || 'fake'}`);
info(`EMBEDDING_PROVIDER=${embeddingProvider}`);
info(`RERANK_PROVIDER=${rerankProvider}`);
info(`OPENAI_EMBEDDING_MODEL=${expectedModel}`);
info(`OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? '已设置' : '未设置'}`);
info(`RERANK_API_KEY=${process.env.RERANK_API_KEY ? '已设置' : '未设置（回落 OPENAI_API_KEY）'}`);

if (embeddingProvider !== 'real') {
  bad('EMBEDDING_PROVIDER 不是 real：查询向量会走 fake，和库里真实向量对不上，必然 0 召回');
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
} catch (e) {
  console.error(`\n✗ 连不上数据库：${e.message}`);
  process.exit(1);
}

try {
  const sources = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE is_indexable)::int AS indexable,
            count(*) FILTER (WHERE compliance_status = 'ok')::int AS compliant
       FROM knowledge_source`,
  );
  const s = sources.rows[0];
  console.log('\n== 知识源 ==');
  info(`总数 ${s.total} / 可索引 ${s.indexable} / 合规 ${s.compliant}`);
  if (s.total === 0) bad('knowledge_source 是空的：生产库没有导知识数据');
  else if (s.indexable === 0) bad('没有 is_indexable=true 的知识源');

  const chunks = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE is_citable)::int AS citable
       FROM knowledge_chunk`,
  );
  const c = chunks.rows[0];
  console.log('\n== 知识片 ==');
  info(`总数 ${c.total} / 可引用 ${c.citable}`);
  if (c.total === 0) bad('knowledge_chunk 是空的：向量数据没导进来');
  else if (c.citable === 0) bad('没有 is_citable=true 的知识片');

  const models = await client.query(
    `SELECT embedding_model, count(*)::int AS n
       FROM knowledge_chunk
      GROUP BY embedding_model
      ORDER BY n DESC`,
  );
  console.log('\n== 向量模型版本 ==');
  for (const row of models.rows) info(`${row.embedding_model}: ${row.n} 片`);
  const realChunks = models.rows.find((r) => r.embedding_model === expectedModel)?.n ?? 0;
  if (embeddingProvider === 'real' && realChunks === 0) {
    bad(`库里没有 embedding_model=${expectedModel} 的片：索引与当前配置不是同一版`);
  }

  const platforms = await client.query(
    `SELECT platform, count(*)::int AS n
       FROM knowledge_source
      WHERE is_indexable AND compliance_status = 'ok'
      GROUP BY platform
      ORDER BY n DESC`,
  );
  console.log('\n== 可检索平台 ==');
  if (platforms.rows.length === 0) bad('没有可检索平台');
  for (const row of platforms.rows) info(`${row.platform}: ${row.n} 个源`);

  const access = await client.query(
    `SELECT u.email, ka.platform
       FROM "user" u
       LEFT JOIN knowledge_access ka ON ka.user_id = u.id
      ORDER BY u.email, ka.platform`,
  );
  console.log('\n== 账号授权 ==');
  const byEmail = new Map();
  for (const row of access.rows) {
    if (!byEmail.has(row.email)) byEmail.set(row.email, []);
    if (row.platform) byEmail.get(row.email).push(row.platform);
  }
  const demos = new Set(['demo@knowfit.local', 'demo2@knowfit.local', 'demo3@knowfit.local']);
  if (byEmail.size === 0) bad('user 表是空的');
  for (const [email, ps] of byEmail) {
    if (ps.length > 0) {
      ok(`${email} → ${ps.join(', ')}`);
    } else if (demos.has(email)) {
      bad(`${email} 没有任何 knowledge_access（demo 账号问知识必然无源）`);
    } else {
      info(`${email} 无授权（新注册账号默认如此）`);
    }
  }
  for (const email of demos) {
    if (!byEmail.has(email)) bad(`缺少 ${email}，先跑 demo seed`);
  }
} finally {
  await client.end();
}

if (failed) {
  console.log('\n发现断点。按上面的 ✗ 逐条修；改完重启 api 再问一次。\n');
  process.exit(1);
}
console.log('\n没发现明显断点。若仍无引用，查 api 日志里的 embedding / rerank / 闸② 报错。\n');