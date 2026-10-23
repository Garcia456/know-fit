#!/usr/bin/env node
/**
 * know-fit 切片与索引检查
 *
 * 一句话：**把索引管线真跑两遍，看片落对了没、重跑会不会长胖、下架会不会带走吧。**
 *
 *   KB_PROVIDER=fake 采一遍 → LLM_PROVIDER=fake + EMBEDDING_PROVIDER=fake 索引一遍
 *     🔴 只索引 fixture 两条（KB_INDEX_KEY）：不带会把真实源也重索引成替身向量
 *     → 断言 stdout 里只有元数据与计数、**没有转写正文**
 *     → 裸 SQL 断言每片：前缀带元数据 / claim_type 只在四类里 / is_citable 与门限一致 /
 *       向量 1024 维 / embedding_model 记了版本 / content_hash 是 64 位
 *   🔴 再跑一遍 → 断言片数不变、行 id 不变（content_hash 幂等）
 *   KB_RETIRE 采一遍 → 断言该源的片清空、行留着
 *     → 收尾：删掉本次落下的源（片随外键级联走）
 *
 * 为什么必须跑真命令行：直接调函数只能证明「函数对」，证明不了入口挂上了、
 * provider 认得对、报告里没夹带正文 —— 那几样才是「跑得起来」最容易断的地方。
 *
 * 用法： node scripts/kb-index-check.mjs        （先 pnpm db:up && pnpm db:migrate）
 * 退出码：0 = 通过；1 = 失败
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';

/** 替身清单里的两条，与 src/kb/fixtures.ts 对齐 */
const KEYS = ['fixture-0001', 'fixture-0002'];
/** 替身转写里的正文片段 —— 它**不该出现**在任何对外输出里 */
const BODY_FRAGMENTS = ['肩胛要收紧', '动作变形了就说明重了'];
const CLAIM_TYPES = ['观点', '事实', '演示', '寒暄'];
const FAKE_MODEL = 'fake-text-embedding-1024';
const CONFIDENCE_THRESHOLD = 0.75;

let failed = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = true;
};

console.log('\n=== know-fit 切片与索引检查 ===\n');

/** 跑命令行入口 —— 🔴 显式写死替身 provider：本检查绝不联网、绝不需要 key */
function run(script, extraEnv = {}) {
  return spawnSync('pnpm', [script], {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      LLM_PROVIDER: 'fake',
      KB_PROVIDER: 'fake',
      ASR_PROVIDER: 'fake',
      EMBEDDING_PROVIDER: 'fake',
      ...extraEnv,
    },
  });
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
} catch (e) {
  bad(`连不上数据库：${e.message}`);
  console.error('     起库：pnpm db:up && pnpm db:migrate');
  process.exit(1);
}

const chunkRows = async (key) =>
  (
    await client.query(
      `SELECT c.id, c.chunk_index, c.context_prefix, c.claim_type, c.is_citable,
              c.asr_confidence, c.embedding_model, c.content_hash,
              vector_dims(c.embedding) AS dims
         FROM knowledge_chunk c JOIN knowledge_source s ON s.id = c.source_id
        WHERE s.platform_video_key = $1 ORDER BY c.chunk_index, c.id`,
      [key],
    )
  ).rows;

/** 非替身源的全部片 —— 检查前后必须一模一样 */
const nonFixtureFingerprint = async () => {
  const r = await client.query(
    `SELECT count(*)::int AS n,
            coalesce(md5(string_agg(c.id::text || ':' || c.embedding_model || ':' || c.content_hash, ',' ORDER BY c.id)), '') AS fp
       FROM knowledge_chunk c JOIN knowledge_source s ON s.id = c.source_id
      WHERE NOT (s.platform_video_key = ANY($1))`,
    [KEYS],
  );
  return r.rows[0];
};

const realBefore = await nonFixtureFingerprint();

try {
  // ── 1. 先采一遍（索引的前提）────────────────────────────────────────
  const ingest = run('kb:ingest');
  if (ingest.status !== 0) {
    bad(`pnpm kb:ingest 退出码 ${ingest.status}`);
    console.error((ingest.stderr ?? '').slice(0, 800));
  } else {
    ok('kb:ingest 跑通（替身解析 + 替身转写）');
  }

  // ── 2. 索引一遍 ────────────────────────────────────────────────────
  // 🔴 必须逐条带 KB_INDEX_KEY：不带会把库里真实源也重索引成替身向量
  const indexRuns = KEYS.map((key) => run('kb:index', { KB_INDEX_KEY: key }));
  const index = indexRuns.find((r) => r.status !== 0) ?? indexRuns[0];
  const stdout = indexRuns.map((r) => r.stdout ?? '').join('\n');
  if (index.status !== 0) {
    bad(`pnpm kb:index 退出码 ${index.status}`);
    console.error((index.stderr ?? '').slice(0, 800));
  } else {
    ok('kb:index 跑通（替身判官 + 替身 embedding）');

    const leaked = BODY_FRAGMENTS.filter((f) => stdout.includes(f));
    if (leaked.length > 0) {
      bad(`报告里漏出了转写正文（含「${leaked.join('」「')}」）`);
    } else {
      ok('报告里没有转写正文 —— 只有元数据与计数');
    }

    if (stdout.includes(FAKE_MODEL) && stdout.includes('1024 维')) {
      ok(`报告里记了 embedding_model = ${FAKE_MODEL}（1024 维）`);
    } else {
      bad('报告里没记 embedding_model / 维度');
    }
  }

  // ── 3. 片真的落对了吗（裸 SQL 读回）────────────────────────────────
  let total = 0;
  for (const key of KEYS) {
    const rows = await chunkRows(key);
    total += rows.length;
    if (rows.length === 0) {
      bad(`${key} 一片都没有`);
      continue;
    }

    const problems = [];
    for (const [i, r] of rows.entries()) {
      if (r.chunk_index !== i) problems.push(`${key}#${i} chunk_index=${r.chunk_index}`);
      if (!r.context_prefix || !r.context_prefix.startsWith('[')) problems.push(`${key}#${i} 前缀缺失`);
      if (!r.context_prefix.includes('·')) problems.push(`${key}#${i} 前缀缺元数据分隔`);
      if (!CLAIM_TYPES.includes(r.claim_type)) problems.push(`${key}#${i} claim_type=${r.claim_type}`);
      const expectedCitable =
        CLAIM_TYPES.slice(0, 2).includes(r.claim_type) &&
        (r.asr_confidence === null || Number(r.asr_confidence) >= CONFIDENCE_THRESHOLD);
      if (r.is_citable !== expectedCitable) {
        problems.push(`${key}#${i} is_citable=${r.is_citable} 与派生规则不符`);
      }
      if (!/^[0-9a-f]{64}$/.test(r.content_hash ?? '')) problems.push(`${key}#${i} content_hash 不是 64 位`);
      if (r.embedding_model !== FAKE_MODEL) problems.push(`${key}#${i} embedding_model=${r.embedding_model}`);
      if (Number(r.dims) !== 1024) problems.push(`${key}#${i} 向量维度=${r.dims}`);
    }

    if (problems.length === 0) {
      ok(`${key}：${rows.length} 片，前缀 / 判据 / 门限 / 向量 / 版本串都对`);
    } else {
      bad(`${key} 有 ${problems.length} 处不对：${problems.slice(0, 6).join('；')}`);
    }
  }

  const idx = await client.query(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'knowledge_chunk'
        AND indexname = 'knowledge_chunk_embedding_hnsw'`,
  );
  if (idx.rowCount === 1 && /hnsw/i.test(idx.rows[0].indexdef) && /vector_cosine_ops/i.test(idx.rows[0].indexdef)) {
    ok('HNSW（cosine）索引在表上');
  } else {
    bad('knowledge_chunk 上没有 HNSW（cosine）索引 —— 0004 迁移跑了吗？');
  }

  // ── 4. 🔴 重跑幂等：片数不长、行 id 不变 ────────────────────────────
  const beforeIds = new Map();
  for (const key of KEYS) beforeIds.set(key, (await chunkRows(key)).map((r) => r.id));

  const rerunRuns = KEYS.map((key) => run('kb:index', { KB_INDEX_KEY: key }));
  const rerun = rerunRuns.find((r) => r.status !== 0) ?? rerunRuns[0];
  const rerunStdout = rerunRuns.map((r) => r.stdout ?? '').join('\n');
  if (rerun.status !== 0) {
    bad(`重跑 pnpm kb:index 退出码 ${rerun.status}`);
  } else {
    let same = true;
    for (const key of KEYS) {
      const after = await chunkRows(key);
      if (after.length !== beforeIds.get(key).length) {
        bad(`${key} 重跑后片数 ${beforeIds.get(key).length} → ${after.length}（幂等被破坏）`);
        same = false;
      } else if (after.map((r) => r.id).join() !== beforeIds.get(key).join()) {
        bad(`${key} 重跑后行 id 变了（该走 upsert，不该删了重建）`);
        same = false;
      }
    }
    if (same) ok(`重跑一遍：${total} 片数量不变、行 id 不变（content_hash 幂等）`);
    if ((rerunStdout ?? '').includes('删掉旧片 0 条')) ok('重跑报告：删掉旧片 0 条');
    else bad('重跑报告里没有「删掉旧片 0 条」');
  }

  // ── 5. 下架联动：片随源走，行留着 ──────────────────────────────────
  const retire = run('kb:ingest', { KB_RETIRE: KEYS[0] });
  if (retire.status !== 0) {
    bad(`带 KB_RETIRE 跑 kb:ingest 退出码 ${retire.status}`);
    console.error((retire.stderr ?? '').slice(0, 800));
  } else {
    const gone = await chunkRows(KEYS[0]);
    const kept = await chunkRows(KEYS[1]);
    const src = await client.query(
      'SELECT is_indexable, compliance_status, transcript_segments FROM knowledge_source WHERE platform_video_key = $1',
      [KEYS[0]],
    );
    const r = src.rows[0];
    if (gone.length === 0 && kept.length > 0 && src.rowCount === 1 && r.is_indexable === false && r.transcript_segments === null) {
      ok(`下架：${KEYS[0]} 的片清空、行留着；${KEYS[1]} 的片不受影响`);
    } else {
      bad(`下架结果不对：${KEYS[0]} 还剩 ${gone.length} 片，行 ${JSON.stringify(r)}`);
    }
    if ((retire.stdout ?? '').includes('该源知识片')) {
      ok('下架报告里有「该源知识片 before → after」');
    } else {
      bad('下架报告里没有知识片前后计数');
    }
  }

  // 报告合并口径：至少有一条可引用片（替身判官对样本判「事实」）
  const citable = await client.query(
    `SELECT count(*)::int AS n FROM knowledge_chunk c
       JOIN knowledge_source s ON s.id = c.source_id
      WHERE s.platform_video_key = ANY($1) AND c.is_citable = true`,
    [KEYS],
  );
  if (citable.rows[0].n > 0) ok(`可引用片 ${citable.rows[0].n} 条（is_citable 真落了库）`);
  else bad('一条可引用片都没有 —— 闸① 接上了吗？');

  // 检查只许碰替身源；真实源的片一行都不许变
  const realAfter = await nonFixtureFingerprint();
  if (realAfter.n === realBefore.n && realAfter.fp === realBefore.fp) {
    ok(`非替身源 ${realAfter.n} 片未被改动`);
  } else {
    bad(`检查改动了非替身源：${realBefore.n} 片 → ${realAfter.n} 片`);
  }
} finally {
  // 收尾：本次落下的源全删 —— 片随外键级联走，检查不该在开发库里留痕
  await client
    .query('DELETE FROM knowledge_source WHERE platform_video_key = ANY($1)', [KEYS])
    .catch((e) => bad(`清理失败：${e.message}`));
  await client.end();
}

if (failed) {
  console.error('\n切片与索引检查未通过。\n');
  process.exit(1);
}
console.log('\n切片与索引检查通过。\n');