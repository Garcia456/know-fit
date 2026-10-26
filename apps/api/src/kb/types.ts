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

/**
 * 白名单里的一个博主 —— 采集的**遍历入口**。
 *
 * 授权单位是**主页**（不是「任意主页」）：代码只遍历白名单里这几条，
 * 不碰推荐流 / 搜索词 / 白名单外的博主。`profile_url` 直接交给解析服务，
 * 它自己解 `sec_uid` —— 本模块不自己解析博主标识。
 */
export const CreatorSchema = z.object({
  creator: z.string().min(1),
  profile_url: z.string().min(1),
  topic_domain: z.string().min(1),
  /** 近 N 条的**上限**（平台返回条数不受控，截断在管线里做） */
  max_items: z.number().int().positive().max(50).default(10),
});
export type Creator = z.infer<typeof CreatorSchema>;

export const WhitelistSchema = z.object({
  $schema_version: z.string(),
  creators: z.array(CreatorSchema).default([]),
  videos: z.array(WhitelistVideoSchema).default([]),
  /**
   * 标题命中就把这条跳过 —— 用来挡推广片。
   *
   * ⚠️ 列表项里**没有「这是广告」这个字段**，只能靠标题里的字样猜，所以这是**启发式**：
   *    词表**由作者维护**（放白名单文件里，改它不用动代码），且**会误伤** ——
   *    正常视频也可能写「送大家一个动作细节」。守不住宁可漏一条，也不要误杀。
   */
  exclude_title_keywords: z.array(z.string().min(1)).default([]),
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

/**
 * 归一后一段不剩 —— **这条不能入库**：空知识源比没有更糟。
 *
 * 🔴 做成**具名错误**而不是普通 `Error`：管线要能把它和「ASR 进程挂了」区分开 ——
 *    前者是**单条视频的正常坏法**（配乐片 / 纯图片 / 模型空转），跳过它继续跑；
 *    后者是**系统性问题**，必须抛穿。
 */
export class EmptyTranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyTranscriptError';
  }
}

/** 一条被跳过的候选 —— 跳过即「采集不完整」，调用方据此让退出码非零 */
export interface IngestSkip {
  platform_video_key: string;
  title: string;
  reason: string;
}

/**
 * 遍历回来的一条候选 —— **只有元数据，音频还没下**。
 * 先过规则（类型 / 标题 / 音轨 / 截断）再下音频，否则会给马上要丢掉的条目白下一遍。
 */
export interface VideoCandidate {
  /** 遍历路径没有作者手填的标签，用平台的内容 id 当键 */
  platform_video_key: string;
  video_id: string;
  creator: string;
  title: string;
  original_url: string;
  duration_sec: number | null;
  /**
   * 视频原始时长（毫秒）—— 配乐片预筛要用**未取整**的值。
   * 用秒会踩：`80734ms` 取整成 `81s` 后，与 `music` 的 `80000ms` 比值掉到 0.988（真值 0.991）→ 误杀。
   */
  duration_ms: number | null;
  published_at: string | null;
  /** 平台给的条目类型 —— 只有 `video` 才往下走（图文没有口播，只有 BGM） */
  kind: string;
  /** 音频 URL；拿不到就是 null —— 该条不可用 */
  audio_url: string | null;
  /**
   * `music.title` —— 抖音标的**来源标签**：博主用原声时是「@X创作的原声」，挂配乐时是**歌名**。
   * ⚠️ 这是**平台文案、会漂移**，所以只作两个信号之一（见 `music_duration_ms`）。
   */
  music_title: string | null;
  /** `music.duration_ms` —— 与 `duration_ms` 同量级时说明这条音轨按视频截断（= 原声） */
  music_duration_ms: number | null;
}

/** robots.txt 检查留痕。`allowed = null` 表示**检查过但结论不适用**。 */
export interface RobotsCheck {
  checked_at: Date;
  allowed: boolean | null;
}

/** 博主作品列表的一页 —— `cursor = null` 表示没有下一页 */
export interface CandidatePage {
  candidates: VideoCandidate[];
  cursor: string | null;
}

/**
 * 采集端 —— 可注入（承 `LlmClient` 同型）。
 *
 * 真实实现走**自建解析服务**；替身只读 fixture、**永不联网**。
 * 管线若把解析写死在这里，CI 就只能跳过整条链路 —— 那等于「长在 CI 外的东西」。
 */
export interface Fetcher {
  /** 钉住的视频 —— 一条直达，不经遍历 */
  fetch(video: WhitelistVideo): Promise<FetchedVideo>;
  /**
   * 遍历一个白名单博主的作品列表 —— **只取元数据，不下音频**。
   * 一页一取：传上一页的 `cursor` 拿下一页；`cursor = null` 表示到头了。
   */
  listCreatorVideos(creator: Creator, cursor?: string | null): Promise<CandidatePage>;
  /** 把一条音频 URL 落成本地文件 */
  downloadAudio(audioUrl: string): Promise<string>;
  checkRobots(): Promise<RobotsCheck>;
  /** 音频用完了 —— 真实实现删临时文件；替身空转 */
  discardAudio(path: string): Promise<void>;
}

/** ASR 端 —— 同样可注入；**替身永不加载模型**（模型 = 又一种外部依赖） */
export interface AsrClient {
  transcribe(audioPath: string): Promise<Transcript>;
}