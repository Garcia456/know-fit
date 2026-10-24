import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FAKE_EMBEDDING_MODEL,
  createFakeEmbeddingClient,
} from '../kb/embedding.js';
import { createFakeRerankClient, type RerankClient } from '../kb/rerank.js';
import { buildVolumeHook } from '../metrics/hook.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { createAssessmentRepo } from './assessment.js';
import { closeDb, getPool } from './pool.js';

/**
 * 检索的五条过滤与落库事务 —— 连真库（过滤是 SQL 的一部分，替身替不掉）。
 * 自清理：只删本文件造的 fixture。
 */

const KEYS = ['rag-unit-s1', 'rag-unit-demo', 'rag-unit-out', 'rag-unit-notindexed', 'rag-unit-blocked'];
const QUERY = '增肌 推日 训练容量下降 怎么调整';
const USER = SINGLE_USER_ID;

const embedder = createFakeEmbeddingClient();

let vector: number[] = [];

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function source(input: {
  key: string;
  platform?: string;
  indexable?: boolean;
  compliance?: string;
}): Promise<string> {
  const rows = await getPool().query<{ id: string }>(
    `INSERT INTO knowledge_source
       (creator, platform, video_id, title, original_url, platform_video_key,
        subtitle_source, fetched_at, robots_checked_at, robots_allowed, is_indexable, compliance_status)
     VALUES ('单测博主', $1, $2, '标题', 'https://www.douyin.com/video/x', $2,
             'asr', now(), now(), null, $3, $4)
     RETURNING id`,
    [input.platform ?? 'douyin', input.key, input.indexable ?? true, input.compliance ?? 'ok'],
  );
  return rows.rows[0]!.id;
}

async function chunk(input: {
  sourceId: string;
  index: number;
  text: string;
  citable?: boolean;
  model?: string;
}): Promise<string> {
  const rows = await getPool().query<{ id: string }>(
    `INSERT INTO knowledge_chunk
       (source_id, chunk_index, segment_key, text, context_prefix, start_ts, end_ts,
        topic_tags, exercise_tags, claim_type, is_citable, asr_confidence,
        content_hash, embedding_model, embedding)
     VALUES ($1, $2, $3, $4, '[单测]', 0, 9, '{}', '{}', '陈述', $5, 0.95, $6, $7, $8::vector)
     RETURNING id`,
    [
      input.sourceId,
      input.index,
      `p1-${input.index * 10}`,
      input.text,
      input.citable ?? true,
      sha256(input.text),
      input.model ?? FAKE_EMBEDDING_MODEL,
      `[${vector.join(',')}]`,
    ],
  );
  return rows.rows[0]!.id;
}

async function purge(): Promise<void> {
  await getPool().query('DELETE FROM knowledge_source WHERE platform_video_key = ANY($1)', [KEYS]);
}

let s1Chunk = '';
let s2Chunk = '';

beforeAll(async () => {
  await purge();
  const [first] = await embedder.embed([QUERY]);
  if (!first) throw new Error('替身 embedding 没返回向量');
  vector = first;

  const s1 = await source({ key: KEYS[0]! });
  s1Chunk = await chunk({ sourceId: s1, index: 0, text: '容量下降的时候先把离心放慢，等动作稳住了再考虑加重量。' });
  // 同源、别的模型 —— 向量一样，但模型串对不上
  await chunk({ sourceId: s1, index: 1, text: `${QUERY}。异模型片。`, model: 'fake-other-1024' });

  const demo = await source({ key: KEYS[1]! });
  s2Chunk = await chunk({ sourceId: demo, index: 0, text: `${QUERY}。演示片。`, citable: false });

  const out = await source({ key: KEYS[2]!, platform: 'bilibili' });
  await chunk({ sourceId: out, index: 0, text: `${QUERY}。站外片。` });

  const notIndexable = await source({ key: KEYS[3]!, indexable: false });
  await chunk({ sourceId: notIndexable, index: 0, text: `${QUERY}。不可索引片。` });

  const blocked = await source({ key: KEYS[4]!, compliance: 'retired' });
  await chunk({ sourceId: blocked, index: 0, text: `${QUERY}。合规不通过片。` });
});

afterAll(async () => {
  await purge();
  await closeDb();
});

describe('检索过滤', () => {
  it('五条过滤都生效：只剩 S1 的陈述片进候选', async () => {
    const seen: string[][] = [];
    const recording: RerankClient = {
      model: 'recording',
      async rerank({ documents, topN }) {
        seen.push(documents);
        return documents.map((_, index) => ({ index, score: 1 })).slice(0, topN);
      },
    };
    const repo = createAssessmentRepo({ embedder, reranker: recording });
    const out = await repo.retrieve({ user_id: USER, query: QUERY });

    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.candidates.map((c) => c.chunk_id)).toEqual([s1Chunk]);
    // 被过滤的片根本没进重排 —— 它们不该有机会被「排第一」
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]![0]).not.toContain(s2Chunk);
    expect(out.meta.embedding_model).toBe(FAKE_EMBEDDING_MODEL);
  });

  it('替身重排按词面重叠排序（只证明管道）', async () => {
    const ranks = await createFakeRerankClient().rerank({
      query: QUERY,
      documents: ['完全不相关的一句话', `${QUERY}，这段话面重合最高`, '容量下降怎么调整'],
      topN: 2,
    });
    expect(ranks[0]?.index).toBe(1);
    expect(ranks).toHaveLength(2);
  });
});

describe('落库事务', () => {
  const verdict = buildVolumeHook({ current: 2000, baseline: 2500, split_label: '推日' });

  it('citation 写失败 → assessment 一起回滚', async () => {
    const repo = createAssessmentRepo({ embedder, reranker: createFakeRerankClient() });
    const marker = `事务回滚-${Date.now()}`;

    await expect(
      repo.persist({
        user_id: USER,
        trigger: 'explicit',
        related_record_id: null,
        verdict,
        advice_text: marker,
        advice_claims: [],
        has_source: true,
        citations: [
          {
            citation_id: '00000000-0000-4000-8000-00000000dead',
            claim_index: 0,
            chunk_id: '00000000-0000-4000-8000-00000000beef', // 不存在的 chunk → 外键失败
            url_with_ts: 'https://www.douyin.com/video/x',
            quote_start: 0,
            quote_end: 12,
          },
        ],
        model_version: 'test',
        judge_model_version: 'test',
        pipeline_meta: {
          embedding_model: FAKE_EMBEDDING_MODEL,
          rerank_model: 'test',
          rerank_degraded: false,
          no_source_reason: null,
        },
      }),
    ).rejects.toThrow();

    const rows = await getPool().query('SELECT count(*)::int AS n FROM assessment WHERE advice_text = $1', [marker]);
    expect(rows.rows[0]?.n).toBe(0);
  });
});
