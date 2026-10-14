import { z } from 'zod';

/**
 * 采集与转写的内部类型与两个可注入接口。
 *
 * 🔴 本文件里的 `TranscriptSegment` 携带转写**原文**，只进库供内部检索使用。
 *    它**绝不允许被抬进 `contracts/`** —— 对外契约里出现全文型字段名会被护栏 R-B 拦下。
 */

/** 一段转写。`text` 是原文，只进库、不出接口。 */
export const TranscriptSegmentSchema = z.object({
  start_ts: z.number().nonnegative(),
  end_ts: z.number().nonnegative(),
  text: z.string(),
  /** 模型自报的把握度；拿不到就是 null，**不编一个数** */
  confidence: z.number().min(0).max(1).nullable(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptSchema = z.object({
  language: z.string().nullable(),
  segments: z.array(TranscriptSegmentSchema),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

/** 白名单里的一条视频 —— 采集只认它，**不存在「发现」这个动作** */
export const WhitelistVideoSchema = z.object({
  platform_video_key: z.string().min(1),
  creator: z.string().min(1),
  title: z.string().min(1),
  original_url: z.string().min(1),
  topic_domain: z.string().min(1),
});
export type WhitelistVideo = z.infer<typeof WhitelistVideoSchema>;

export const WhitelistSchema = z.object({
  $schema_version: z.string(),
  videos: z.array(WhitelistVideoSchema),
});
export type Whitelist = z.infer<typeof WhitelistSchema>;

/** 解析服务返回的一条视频 —— 只保留落库与转写要用的字段 */
export interface FetchedVideo {
  platform_video_key: string;
  video_id: string;
  creator: string;
  title: string;
  original_url: string;
  duration_sec: number | null;
  published_at: string | null;
  /** 已落地的本地音频文件；管线用完即删 */
  audio_path: string;
}

/** robots.txt 检查留痕。`allowed = null` 表示**检查过但结论不适用**。 */
export interface RobotsCheck {
  checked_at: Date;
  allowed: boolean | null;
}

/**
 * 采集端 —— 可注入（承 `LlmClient` 同型）。
 *
 * 真实实现走**自建解析服务**；替身只读 fixture、**永不联网**。
 * 管线若把解析写死在这里，CI 就只能跳过整条链路 —— 那等于「长在 CI 外的东西」。
 */
export interface Fetcher {
  fetch(video: WhitelistVideo): Promise<FetchedVideo>;
  checkRobots(): Promise<RobotsCheck>;
  /** 音频用完了 —— 真实实现删临时文件；替身空转 */
  discardAudio(path: string): Promise<void>;
}

/** ASR 端 —— 同样可注入；**替身永不加载模型**（模型 = 又一种外部依赖） */
export interface AsrClient {
  transcribe(audioPath: string): Promise<Transcript>;
}