import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeTranscript } from '../asr/parse.js';
import { closeDb, getPool } from '../services/pool.js';
import { loadIndexableSources, replaceSourceChunks } from '../services/chunks.js';
import { retireSource } from '../services/knowledge.js';
import { createFakeClaimJudge, CLAIM_TYPES } from './claimJudge.js';
import { createFakeEmbeddingClient, FAKE_EMBEDDING_MODEL } from './embedding.js';
import { FIXTURE_TRANSCRIPT } from './fixtures.js';
import { indexSource } from './indexer.js';

/**
 * 切片 → 判据 → 向量 → 落库 —— 与图测试相反：这里**必须连真库**。
 *
 * 走替身判官 + 替身 embedding（不联网、不需要 key），证明的是「管道通 + 幂等」；
 * 「判得准」只能由 promptfoo + 人工标注回答（evals/）。
 *
 * 前置：pnpm db:up && pnpm db:migrate。
 * 🔴 用**本文件独占的 key** 直接插源：vitest 并行跑文件，蹭 fixture- 前缀会被
 *    pipeline.test 的清理顺手删掉（实测踩到过）。
 */

const KEY = 'indexer-test-0001';
/** 缩小上下限，让两条短转写切得开 —— 验的是编排，不是默认参数 */
const SMALL = { minChars: 20, maxChars: 40, overlapRatio: 0.125 };

let sourceId = '';

const deps = () => ({
  judge: createFakeClaimJudge(),
  embedder: createFakeEmbeddingClient(),
  chunkOptions: SMALL,
});

async function source(): Promise<NonNullable<Awaited<ReturnType<typeof loadIndexableSources>>[number]>> {
  const all = await loadIndexableSources();
  const found = all.find((s) => s.platformVideoKey === KEY);
  if (!found) throw new Error(`没找到 ${KEY} —— 库起没起？迁移跑没跑？`);
  return found;
}

beforeAll(async () => {
  try {
    await getPool().query('SELECT 1');
  } catch (e) {
    throw new Error(
      `连不上数据库 —— 本测试要真库：pnpm db:up && pnpm db:migrate。原始错误：${(e as Error).message}`,
      { cause: e },
    );
  }
  await getPool().query('DELETE FROM knowledge_source WHERE platform_video_key = $1', [KEY]);
  const segments = normalizeTranscript(FIXTURE_TRANSCRIPT);
  const inserted = await getPool().query(
    `INSERT INTO knowledge_source
       (creator, platform, video_id, title, original_url, compliance_status,
        platform_video_key, subtitle_source, fetched_at, robots_checked_at,
        is_indexable, topic_domain, transcript_segments)
     VALUES ('替身博主甲', 'douyin', 'indexer-test', '替身样本：卧推动作拆解',
             'https://www.douyin.com/video/indexer-test', 'ok',
             $1, 'asr', now(), now(), true, '训练动作', $2::jsonb)
     RETURNING id`,
    [KEY, JSON.stringify(segments.segments)],
  );
  sourceId = inserted.rows[0].id;
});

afterAll(async () => {
  await getPool().query('DELETE FROM knowledge_source WHERE platform_video_key = $1', [KEY]);
  await closeDb();
});

describe('indexSource：一条源的完整一跳', () => {
  it('切出的片按序落库，元数据 / 判据 / 向量都齐', async () => {
    const report = await indexSource(await source(), deps());
    expect(report.chunks).toBe(2);
    expect(report.stored.before).toBe(0);
    expect(report.stored.after).toBe(2);

    const rows = await getPool().query(
      `SELECT chunk_index, segment_key, text, context_prefix, start_ts, end_ts, topic_tags, exercise_tags,
              claim_type, is_citable, asr_confidence, content_hash, embedding_model,
              vector_dims(embedding) AS dims
         FROM knowledge_chunk WHERE source_id = $1 ORDER BY chunk_index`,
      [sourceId],
    );
    expect(rows.rowCount).toBe(2);

    for (const [i, r] of rows.rows.entries()) {
      expect(r.chunk_index).toBe(i);
      expect(r.text.length).toBeGreaterThan(0);
      // 每片都有前缀，且前缀带齐博主 / 标题 / 时间 / 主题
      expect(r.context_prefix).toContain('替身博主甲');
      expect(r.context_prefix).toContain('替身样本：卧推动作拆解');
      expect(r.context_prefix).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
      expect(r.context_prefix).toContain('训练动作');
      // 第二片起带上一片尾句；首片没有
      if (i === 0) expect(r.context_prefix).not.toContain('前文');
      else expect(r.context_prefix).toContain('前文：');
      // 定位键 = p1-<start_ts>
      expect(r.segment_key).toBe(`p1-${Number(r.start_ts).toFixed(1)}`);
      expect(r.topic_tags).toEqual(['训练动作']);
      expect(Array.isArray(r.exercise_tags)).toBe(true);
      // 判据只落四类之一，is_citable 是真布尔
      expect(CLAIM_TYPES).toContain(r.claim_type);
      expect(typeof r.is_citable).toBe('boolean');
      expect(r.asr_confidence).toBeGreaterThan(0);
      expect(r.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.embedding_model).toBe(FAKE_EMBEDDING_MODEL);
      expect(Number(r.dims)).toBe(1024);
    }

    // 短引用逐字来自本片正文 —— 不是概括
    expect(report.sample).not.toBeNull();
    expect(rows.rows[0].text).toContain(report.sample!.shortQuote);
  });

  it('🔴 重跑不新增片（content_hash 幂等）', async () => {
    const before = await getPool().query(
      'SELECT id FROM knowledge_chunk WHERE source_id = $1 ORDER BY chunk_index',
      [sourceId],
    );
    const report = await indexSource(await source(), deps());
    const after = await getPool().query(
      'SELECT id FROM knowledge_chunk WHERE source_id = $1 ORDER BY chunk_index',
      [sourceId],
    );
    expect(report.stored).toEqual({ before: 2, after: 2, deleted: 0 });
    expect(after.rowCount).toBe(2);
    // 同 hash 走 upsert：行 id 不变，不会长出新片
    expect(after.rows.map((r) => r.id)).toEqual(before.rows.map((r) => r.id));
  });

  it('切片规则变了 → 旧片被清掉，不留孤儿', async () => {
    // 换一组参数（一片装下全部）→ 旧的两条 hash 都不在新批里
    const report = await indexSource(await source(), {
      judge: createFakeClaimJudge(),
      embedder: createFakeEmbeddingClient(),
      chunkOptions: { minChars: 300, maxChars: 600, overlapRatio: 0.125 },
    });
    expect(report.chunks).toBe(1);
    expect(report.stored).toEqual({ before: 2, after: 1, deleted: 2 });
    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM knowledge_chunk WHERE source_id = $1',
      [sourceId],
    );
    expect(rows.rows[0].n).toBe(1);

    // 换回小参数，给下一条用例留出两片
    await indexSource(await source(), deps());
  });

  it('传空批 → 该源的片全删（不是「什么都不做」）', async () => {
    const out = await replaceSourceChunks(sourceId, []);
    expect(out).toEqual({ before: 2, after: 0, deleted: 2 });
    // 复原，给下架用例留出两片
    await indexSource(await source(), deps());
  });
});

describe('下架联动', () => {
  it('🔴 下架源时片随行删除，行本身留着（留痕）', async () => {
    const report = await retireSource(sourceId);
    expect(report.chunks_before).toBe(2);
    expect(report.chunks_after).toBe(0);

    const chunks = await getPool().query(
      'SELECT count(*)::int AS n FROM knowledge_chunk WHERE source_id = $1',
      [sourceId],
    );
    expect(chunks.rows[0].n).toBe(0);
    const src = await getPool().query(
      'SELECT is_indexable, compliance_status FROM knowledge_source WHERE id = $1',
      [sourceId],
    );
    expect(src.rowCount).toBe(1);
    expect(src.rows[0].is_indexable).toBe(false);
    expect(src.rows[0].compliance_status).toBe('retired');
  });

  it('下架的源不再进待索引集合', async () => {
    const keys = (await loadIndexableSources()).map((s) => s.platformVideoKey);
    expect(keys).not.toContain(KEY);
  });
});