import { and, eq, notInArray, sql } from 'drizzle-orm';
import { knowledgeChunk, knowledgeSource } from '../db/schema.js';
import { TranscriptSegmentSchema } from '../kb/types.js';
import { getDb } from './pool.js';
import type { TranscriptSegment } from '../kb/types.js';

/**
 * 知识片的读写。
 * 🔴 `text` 只进库、绝不出接口 —— 服务层返回它只给本机索引管线用。
 */

export interface IndexableSource {
  id: string;
  platformVideoKey: string;
  creator: string;
  title: string;
  topicDomain: string | null;
  segments: TranscriptSegment[];
}

export interface ChunkInsert {
  chunkIndex: number;
  segmentKey: string;
  text: string;
  contextPrefix: string;
  startTs: number;
  endTs: number;
  topicTags: string[];
  exerciseTags: string[];
  claimType: string;
  isCitable: boolean;
  asrConfidence: number | null;
  contentHash: string;
  embeddingModel: string;
  embedding: number[];
}

/**
 * 待索引的源 —— 只取 `is_indexable = true` 且转写不空的行。
 * 下架的行**不切片**：下架通道靠这个生效。
 */
export async function loadIndexableSources(): Promise<IndexableSource[]> {
  const rows = await getDb()
    .select({
      id: knowledgeSource.id,
      key: knowledgeSource.platformVideoKey,
      creator: knowledgeSource.creator,
      title: knowledgeSource.title,
      topicDomain: knowledgeSource.topicDomain,
      segments: knowledgeSource.transcriptSegments,
    })
    .from(knowledgeSource)
    .where(and(eq(knowledgeSource.isIndexable, true), sql`${knowledgeSource.transcriptSegments} IS NOT NULL`))
    .orderBy(knowledgeSource.platformVideoKey);

  return rows.flatMap((row) => {
    const raw = Array.isArray(row.segments) ? row.segments : [];
    const parsed = raw.map((s: unknown) => TranscriptSegmentSchema.safeParse(s));
    const bad = parsed.find((p) => !p.success);
    if (bad) {
      throw new Error(`知识源 ${row.key} 的转写段结构不对：${bad.error.issues[0]?.message ?? '未知'}`);
    }
    const segments = parsed.flatMap((p) => (p.success ? [p.data] : []));
    if (segments.length === 0) return [];
    return [
      {
        id: row.id,
        platformVideoKey: row.key,
        creator: row.creator,
        title: row.title,
        topicDomain: row.topicDomain,
        segments,
      },
    ];
  });
}

/**
 * 用一批片替换某条源的片。
 *
 * 幂等：按 `(source_id, content_hash)` 判重，且**删掉不在本批里的旧片** ——
 * 重跑同一条源不新增片；切片规则变了也不会留下孤片。
 */
export async function replaceSourceChunks(
  sourceId: string,
  rows: ChunkInsert[],
): Promise<{ before: number; after: number; deleted: number }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: knowledgeChunk.id })
      .from(knowledgeChunk)
      .where(eq(knowledgeChunk.sourceId, sourceId));
    const hashes = rows.map((r) => r.contentHash);

    let deleted: number;
    if (hashes.length > 0) {
      const removed = await tx
        .delete(knowledgeChunk)
        .where(and(eq(knowledgeChunk.sourceId, sourceId), notInArray(knowledgeChunk.contentHash, hashes)))
        .returning({ id: knowledgeChunk.id });
      deleted = removed.length;
    } else {
      const removed = await tx
        .delete(knowledgeChunk)
        .where(eq(knowledgeChunk.sourceId, sourceId))
        .returning({ id: knowledgeChunk.id });
      deleted = removed.length;
    }

    if (rows.length > 0) {
      await tx
        .insert(knowledgeChunk)
        .values(rows.map((r) => ({ sourceId, ...r })))
        .onConflictDoUpdate({
          target: [knowledgeChunk.sourceId, knowledgeChunk.contentHash],
          set: {
            chunkIndex: sql`excluded.chunk_index`,
            segmentKey: sql`excluded.segment_key`,
            text: sql`excluded.text`,
            contextPrefix: sql`excluded.context_prefix`,
            startTs: sql`excluded.start_ts`,
            endTs: sql`excluded.end_ts`,
            topicTags: sql`excluded.topic_tags`,
            exerciseTags: sql`excluded.exercise_tags`,
            claimType: sql`excluded.claim_type`,
            isCitable: sql`excluded.is_citable`,
            asrConfidence: sql`excluded.asr_confidence`,
            embeddingModel: sql`excluded.embedding_model`,
            embedding: sql`excluded.embedding`,
          },
        });
    }

    const after = await tx
      .select({ id: knowledgeChunk.id })
      .from(knowledgeChunk)
      .where(eq(knowledgeChunk.sourceId, sourceId));
    return { before: existing.length, after: after.length, deleted };
  });
}

/** R-C 用：全部片正文 —— 只在进程内做窗口哈希，绝不外传 */
export async function loadAllChunkTexts(): Promise<string[]> {
  const rows = await getDb().select({ text: knowledgeChunk.text }).from(knowledgeChunk);
  return rows.map((r) => r.text);
}

export async function countChunks(sourceId?: string): Promise<number> {
  const rows = sourceId
    ? await getDb().select({ id: knowledgeChunk.id }).from(knowledgeChunk).where(eq(knowledgeChunk.sourceId, sourceId))
    : await getDb().select({ id: knowledgeChunk.id }).from(knowledgeChunk);
  return rows.length;
}

/** 下架源时清除它的片 —— 行留着留痕，片必须走 */
export async function deleteChunksForSource(sourceId: string): Promise<number> {
  const rows = await getDb()
    .delete(knowledgeChunk)
    .where(eq(knowledgeChunk.sourceId, sourceId))
    .returning({ id: knowledgeChunk.id });
  return rows.length;
}