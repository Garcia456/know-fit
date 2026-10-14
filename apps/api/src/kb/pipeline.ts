import { upsertSource } from '../services/knowledge.js';
import { assertWhitelisted } from './whitelist.js';
import type { IngestedSource } from '../contracts/knowledge.js';
import type { AsrClient, Fetcher, RobotsCheck, Whitelist } from './types.js';

/**
 * 采集 → 转写 → 落库 的编排。
 *
 * 顺序里有一处刻意的设计：**白名单判定发生在任何外部动作之前**。
 * 反过来写（先抓再判）等于「先碰了内容再决定要不要碰」——
 * 那正是「采集模块悄悄长成爬虫」的第一步。
 *
 * 音频用完即删（§五 第 5 条）：音频是「完整复制」最重的形态，
 * 转写一旦落地它就没有留的理由，故写在 `finally` 里 —— 转写失败也照样删。
 */

export interface IngestDeps {
  fetcher: Fetcher;
  asr: AsrClient;
}

const iso = (d: Date): string => d.toISOString();

export async function ingestVideo(
  whitelist: Whitelist,
  deps: IngestDeps,
  key: string,
  robots: RobotsCheck,
): Promise<IngestedSource> {
  const video = assertWhitelisted(whitelist, key);

  const fetched = await deps.fetcher.fetch(video);
  let transcript;
  try {
    transcript = await deps.asr.transcribe(fetched.audio_path);
  } finally {
    await deps.fetcher.discardAudio(fetched.audio_path);
  }

  const fetchedAt = new Date();
  const sourceId = await upsertSource({
    creator: fetched.creator,
    platform: 'douyin',
    video_id: fetched.video_id,
    title: fetched.title,
    original_url: fetched.original_url,
    duration_sec: fetched.duration_sec,
    published_at: fetched.published_at,
    compliance_status: 'ok',
    platform_video_key: fetched.platform_video_key,
    subtitle_source: 'asr',
    fetched_at: fetchedAt,
    robots_checked_at: robots.checked_at,
    robots_allowed: robots.allowed,
    topic_domain: video.topic_domain,
    transcript,
  });

  return {
    source_id: sourceId,
    platform: 'douyin',
    platform_video_key: fetched.platform_video_key,
    video_id: fetched.video_id,
    creator: fetched.creator,
    title: fetched.title,
    original_url: fetched.original_url,
    topic_domain: video.topic_domain,
    duration_sec: fetched.duration_sec,
    published_at: fetched.published_at,
    subtitle_source: 'asr',
    segment_count: transcript.segments.length,
    fetched_at: iso(fetchedAt),
    robots_checked_at: iso(robots.checked_at),
    robots_allowed: robots.allowed,
    is_indexable: true,
    compliance_status: 'ok',
  };
}

/** 跑一批。robots 一次检查覆盖整批 —— 它是站点级判定，不是每条视频一次。 */
export async function ingestAll(
  whitelist: Whitelist,
  deps: IngestDeps,
  keys?: string[],
): Promise<{ robots: RobotsCheck; sources: IngestedSource[] }> {
  const robots = await deps.fetcher.checkRobots();
  const targets = keys ?? whitelist.videos.map((v) => v.platform_video_key);

  const sources: IngestedSource[] = [];
  for (const key of targets) {
    sources.push(await ingestVideo(whitelist, deps, key, robots));
  }
  return { robots, sources };
}