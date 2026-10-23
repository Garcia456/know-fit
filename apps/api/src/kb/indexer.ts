import { createHash } from 'node:crypto';
import { replaceSourceChunks } from '../services/chunks.js';
import { chunkTranscript, DEFAULT_CHUNK_OPTIONS } from './chunk.js';
import {
  CLAIM_TYPES,
  DEFAULT_CONFIDENCE_THRESHOLD,
  deriveIsCitable,
  meanConfidence,
} from './claimJudge.js';
import { matchExerciseTags } from './exerciseTags.js';
import { buildContextPrefix } from './prefix.js';
import { extractShortQuote } from './quote.js';
import type { ChunkOptions } from './chunk.js';
import type { ClaimJudge, ClaimType } from './claimJudge.js';
import type { EmbeddingClient } from './embedding.js';
import { EMBEDDING_DIMENSIONS } from './embedding.js';
import type { ChunkInsert, IndexableSource } from '../services/chunks.js';

/**
 * 源 → 可召回的片 的编排。
 *
 * 一条源的完整一跳：
 *   切段 → 拼 `context_prefix` → 闸①（claim_type / 置信度）→ `exercise_tags`
 *   → 向量化（prefix + 全文）→ 按 `content_hash` 幂等落库。
 *
 * 🔴 本模块不做检索：没有相似度、没有 top-K、没有 rerank。
 * 🔴 `text` 与 `context_prefix` 只进库；对外短引用在检索层按确定性规则**逐字摘**。
 */

export interface IndexDeps {
  judge: ClaimJudge;
  embedder: EmbeddingClient;
  chunkOptions?: ChunkOptions;
  confidenceThreshold?: number;
  /** 闸① 并发数 —— 单条串行太慢，4 与评测侧一致 */
  judgeConcurrency?: number;
  onProgress?: (e: IndexProgress) => void;
}

export type IndexProgress =
  | { stage: 'start'; platform_video_key: string; segments: number }
  | { stage: 'chunked'; platform_video_key: string; chunks: number }
  | { stage: 'judged'; platform_video_key: string; done: number; total: number }
  | { stage: 'embedded'; platform_video_key: string; vectors: number }
  | { stage: 'stored'; platform_video_key: string; before: number; after: number; deleted: number };

export interface ChunkSample {
  text: string;
  contextPrefix: string;
  shortQuote: string;
  startTs: number;
  endTs: number;
}

export interface SourceIndexReport {
  platform_video_key: string;
  title: string;
  segments: number;
  chunks: number;
  chars: { min: number; max: number; avg: number };
  /** 触发「低于下限并片 / 单段超长」的片数 */
  notes: { merged_low: number; over_limit: number };
  claim_distribution: Record<ClaimType, number>;
  citable: number;
  /** 被 ASR 置信度门限挡下的片数（claim_type 本来可引用） */
  excluded_by_confidence: number;
  exercise_tagged_chunks: number;
  overlap_ratio: { min: number; avg: number };
  stored: { before: number; after: number; deleted: number };
  sample: ChunkSample | null;
}

export interface IndexReport {
  embedding_model: string;
  dimensions: number;
  sources: SourceIndexReport[];
  totals: {
    sources: number;
    chunks: number;
    citable: number;
    excluded_by_confidence: number;
    claim_distribution: Record<ClaimType, number>;
  };
}

const hashChunk = (prefix: string, text: string): string =>
  createHash('sha256').update(`${prefix}\n${text}`, 'utf8').digest('hex');

/** 有并发上限的 map —— 结果保持输入顺序 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

const round = (n: number, digits = 3): number => Number(n.toFixed(digits));

export async function indexSource(source: IndexableSource, deps: IndexDeps): Promise<SourceIndexReport> {
  const opts = deps.chunkOptions ?? DEFAULT_CHUNK_OPTIONS;
  const threshold = deps.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  deps.onProgress?.({ stage: 'start', platform_video_key: source.platformVideoKey, segments: source.segments.length });
  const chunks = chunkTranscript(source.segments, opts);
  deps.onProgress?.({ stage: 'chunked', platform_video_key: source.platformVideoKey, chunks: chunks.length });

  if (chunks.length === 0) {
    throw new Error(`知识源 ${source.platformVideoKey} 切不出片 —— 转写段全空？`);
  }

  const rows: ChunkInsert[] = [];
  const claimDistribution = Object.fromEntries(CLAIM_TYPES.map((t) => [t, 0])) as Record<ClaimType, number>;
  let citable = 0;
  let excludedByConfidence = 0;
  let exerciseTagged = 0;
  let mergedLow = 0;
  let overLimit = 0;
  const overlapRatios: number[] = [];

  const prepared = chunks.map((chunk, i) => {
    const previousText = i > 0 ? chunks[i - 1]!.text : undefined;
    const contextPrefix = buildContextPrefix({
      creator: source.creator,
      title: source.title,
      topicDomain: source.topicDomain,
      start_ts: chunk.start_ts,
      end_ts: chunk.end_ts,
      previousText,
    });
    const partSegments = source.segments.slice(chunk.first_segment, chunk.last_segment + 1);
    return { chunk, i, contextPrefix, asrConfidence: meanConfidence(partSegments) };
  });

  // 闸① 看的是「前缀 + 全文」：前缀把片外指代补上，模型才判得准
  let judged = 0;
  const claimTypes = await mapConcurrent(prepared, deps.judgeConcurrency ?? 4, async (p) => {
    const claimType = await deps.judge.judge(`${p.contextPrefix}\n${p.chunk.text}`);
    judged++;
    deps.onProgress?.({
      stage: 'judged',
      platform_video_key: source.platformVideoKey,
      done: judged,
      total: chunks.length,
    });
    return claimType;
  });

  for (const [i, p] of prepared.entries()) {
    const { chunk, contextPrefix, asrConfidence } = p;
    const claimType = claimTypes[i]!;
    const citableNow = deriveIsCitable(claimType, asrConfidence, threshold);

    claimDistribution[claimType]++;
    if (citableNow) citable++;
    else if (deriveIsCitable(claimType, null) && asrConfidence !== null && asrConfidence < threshold) {
      excludedByConfidence++;
    }

    const exerciseTags = matchExerciseTags(chunk.text);
    if (exerciseTags.length > 0) exerciseTagged++;
    if (chunk.notes.some((n) => n.includes('低于下限'))) mergedLow++;
    if (chunk.notes.some((n) => n.includes('单段超长'))) overLimit++;
    if (i > 0 && chunk.text.length > 0) overlapRatios.push(chunk.overlap_chars / chunk.text.length);

    rows.push({
      chunkIndex: i,
      segmentKey: `p1-${chunk.start_ts.toFixed(1)}`,
      text: chunk.text,
      contextPrefix,
      startTs: chunk.start_ts,
      endTs: chunk.end_ts,
      topicTags: source.topicDomain ? [source.topicDomain] : [],
      exerciseTags,
      claimType,
      isCitable: citableNow,
      asrConfidence,
      contentHash: hashChunk(contextPrefix, chunk.text),
      embeddingModel: deps.embedder.model,
      embedding: [] as number[],
    });
  }

  // 向量化的输入 = 前缀 + 全文 —— 前缀参与 embedding、不参与呈现
  const vectors = await deps.embedder.embed(rows.map((r) => `${r.contextPrefix}\n${r.text}`));
  if (vectors.length !== rows.length) {
    throw new Error(`向量条数不对：${vectors.length} 条对 ${rows.length} 片`);
  }
  for (const [i, v] of vectors.entries()) rows[i]!.embedding = v;
  deps.onProgress?.({ stage: 'embedded', platform_video_key: source.platformVideoKey, vectors: vectors.length });

  const stored = await replaceSourceChunks(source.id, rows);
  deps.onProgress?.({
    stage: 'stored',
    platform_video_key: source.platformVideoKey,
    before: stored.before,
    after: stored.after,
    deleted: stored.deleted,
  });

  const lengths = rows.map((r) => r.text.length);
  const first = rows[0];
  return {
    platform_video_key: source.platformVideoKey,
    title: source.title,
    segments: source.segments.length,
    chunks: rows.length,
    chars: {
      min: Math.min(...lengths),
      max: Math.max(...lengths),
      avg: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    },
    notes: { merged_low: mergedLow, over_limit: overLimit },
    claim_distribution: claimDistribution,
    citable,
    excluded_by_confidence: excludedByConfidence,
    exercise_tagged_chunks: exerciseTagged,
    overlap_ratio: {
      min: round(overlapRatios.length ? Math.min(...overlapRatios) : 0),
      avg: round(overlapRatios.length ? overlapRatios.reduce((a, b) => a + b, 0) / overlapRatios.length : 0),
    },
    stored,
    sample:
      first === undefined
        ? null
        : {
            text: first.text,
            contextPrefix: first.contextPrefix,
            shortQuote: extractShortQuote(first.text),
            startTs: first.startTs,
            endTs: first.endTs,
          },
  };
}

export async function indexSources(sources: IndexableSource[], deps: IndexDeps): Promise<IndexReport> {
  const reports: SourceIndexReport[] = [];
  for (const source of sources) {
    reports.push(await indexSource(source, deps));
  }

  const claimDistribution = Object.fromEntries(CLAIM_TYPES.map((t) => [t, 0])) as Record<ClaimType, number>;
  for (const r of reports) {
    for (const t of CLAIM_TYPES) claimDistribution[t] += r.claim_distribution[t];
  }

  return {
    embedding_model: deps.embedder.model,
    dimensions: EMBEDDING_DIMENSIONS,
    sources: reports,
    totals: {
      sources: reports.length,
      chunks: reports.reduce((a, r) => a + r.chunks, 0),
      citable: reports.reduce((a, r) => a + r.citable, 0),
      excluded_by_confidence: reports.reduce((a, r) => a + r.excluded_by_confidence, 0),
      claim_distribution: claimDistribution,
    },
  };
}