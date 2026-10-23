import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { knowledgeSource } from '../db/schema.js';
import type { RetireReport } from '../contracts/knowledge.js';
import type { Transcript, TranscriptSegment } from '../kb/types.js';
import { countChunks, deleteChunksForSource } from './chunks.js';
import { getDb } from './pool.js';

/**
 * 知识源的读写。
 * 🔴 服务层是唯一可以直接 import `db/schema` 的地方 —— 路由层与管线都不许。
 */

/** 下架时按内容定位的锚 —— 取归一后的转写正文，段序与空白都不影响结果 */
export function hashTranscript(transcript: Transcript): string {
  const body = transcript.segments.map((s) => s.text.trim()).join('\n');
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export interface UpsertSourceInput {
  creator: string;
  platform: string;
  video_id: string;
  title: string;
  original_url: string;
  duration_sec: number | null;
  published_at: string | null;
  compliance_status: string;
  platform_video_key: string;
  subtitle_source: string;
  fetched_at: Date;
  robots_checked_at: Date;
  robots_allowed: boolean | null;
  topic_domain: string | null;
  transcript: Transcript;
}

/**
 * 写一条知识源。
 *
 * 按 `platform_video_key` 幂等：重采同一条视频是**更新**而不是撞唯一约束 ——
 * 本地真跑要反复试，每次都留下一条重复行会让「库里到底有多少料」这个数字失真。
 */
export async function upsertSource(input: UpsertSourceInput): Promise<string> {
  const db = getDb();
  const values = {
    creator: input.creator,
    platform: input.platform,
    videoId: input.video_id,
    title: input.title,
    originalUrl: input.original_url,
    durationSec: input.duration_sec,
    publishedAt: input.published_at ? new Date(input.published_at) : null,
    complianceStatus: input.compliance_status,
    platformVideoKey: input.platform_video_key,
    subtitleSource: input.subtitle_source,
    fetchedAt: input.fetched_at,
    robotsCheckedAt: input.robots_checked_at,
    robotsAllowed: input.robots_allowed,
    isIndexable: true,
    topicDomain: input.topic_domain,
    transcriptSegments: input.transcript.segments,
    contentHash: hashTranscript(input.transcript),
  };

  const [row] = await db
    .insert(knowledgeSource)
    .values(values)
    .onConflictDoUpdate({ target: knowledgeSource.platformVideoKey, set: values })
    .returning({ id: knowledgeSource.id });

  if (!row) throw new Error('knowledge_source 插入没有返回 id');
  return row.id;
}

/**
 * 读回一条源的转写段 —— 只给**本机复核用**（kb:smoke 要肉眼确认转的是口播）。
 * 🔴 它返回的是内部类型，**任何路由都不许调它**；对外只有短引用 + 时间戳 + 链接。
 */
export async function loadTranscript(sourceId: string): Promise<TranscriptSegment[]> {
  const rows = await getDb()
    .select({ segments: knowledgeSource.transcriptSegments })
    .from(knowledgeSource)
    .where(eq(knowledgeSource.id, sourceId));

  const segments = rows[0]?.segments;
  return Array.isArray(segments) ? (segments as TranscriptSegment[]) : [];
}

async function countIndexable(): Promise<number> {
  const rows = await getDb()
    .select({ id: knowledgeSource.id })
    .from(knowledgeSource)
    .where(eq(knowledgeSource.isIndexable, true));
  return rows.length;
}

/**
 * 下架一条知识源。
 *
 * 两件事一起做，缺一不可：
 *   1. `is_indexable = false` —— 检索侧从此看不到它（这道闸在 dev-005）；
 *   2. **清掉转写产物** —— 内容本身不再留在库里。
 * 而**行本身保留**（含 `content_hash`）：下架要留痕，否则「我们下架过什么」无从指认。
 */
export async function retireSource(sourceId: string): Promise<RetireReport> {
  const db = getDb();

  const before = await db
    .select({ segments: knowledgeSource.transcriptSegments })
    .from(knowledgeSource)
    .where(eq(knowledgeSource.id, sourceId));
  if (before.length === 0) throw new Error(`没有 id = ${sourceId} 的知识源`);

  const sourcesBefore = await countIndexable();
  const segmentsBefore = Array.isArray(before[0]?.segments) ? before[0].segments.length : 0;
  const chunksBefore = await countChunks(sourceId);

  await db
    .update(knowledgeSource)
    .set({
      isIndexable: false,
      complianceStatus: 'retired',
      transcriptSegments: null,
    })
    .where(eq(knowledgeSource.id, sourceId));

  // 片跟着源一起走 —— 只置 is_indexable 不清片，下架通道就只做了一半
  await deleteChunksForSource(sourceId);
  const chunksAfter = await countChunks(sourceId);

  const sourcesAfter = await countIndexable();

  return {
    source_id: sourceId,
    is_indexable: false,
    compliance_status: 'retired',
    sources_before: sourcesBefore,
    sources_after: sourcesAfter,
    segments_before: segmentsBefore,
    segments_after: 0,
    chunks_before: chunksBefore,
    chunks_after: chunksAfter,
  };
}