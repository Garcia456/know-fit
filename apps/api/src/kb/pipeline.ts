import { upsertSource } from '../services/knowledge.js';
import { assertWhitelisted, assertWhitelistedCreator } from './whitelist.js';
import type { IngestedSource } from '../contracts/knowledge.js';
import type {
  AsrClient,
  Fetcher,
  FetchedVideo,
  RobotsCheck,
  Transcript,
  VideoCandidate,
  Whitelist,
} from './types.js';

/**
 * 采集 → 转写 → 落库 的编排。
 *
 * 顺序里有一处刻意的设计：**白名单判定发生在任何外部动作之前**。
 * 反过来写（先抓再判）等于「先碰了内容再决定要不要碰」——
 * 那正是「采集模块悄悄长成爬虫」的第一步。遍历路径同理：先认主页，再列作品。
 *
 * 音频用完即删（§五 第 5 条）：音频是「完整复制」最重的形态，
 * 转写一旦落地它就没有留的理由，故写在 `finally` 里 —— 转写失败也照样删。
 */

export interface IngestDeps {
  fetcher: Fetcher;
  asr: AsrClient;
  /** 进度回调 —— 只为「终端上看得见它在动」而存在（CPU 转写一条要几分钟到几十分钟） */
  onProgress?: (e: IngestProgress) => void;
}

/** 采集进度事件（可选，谁传谁打） */
export type IngestProgress =
  | {
      stage: 'listed';
      creator: string;
      candidates: number;
      picked: number;
      /** 被**排除词**挡下的标题 —— 定义 §3.1 第 5 条要求真跑时能肉眼看有没有误杀 */
      excluded: string[];
    }
  | { stage: 'transcribe'; platform_video_key: string; title: string; duration_sec: number | null }
  | { stage: 'done'; platform_video_key: string; segments: number };

const iso = (d: Date): string => d.toISOString();

/**
 * 遍历回来的候选 → 真正要采的那几条。**纯函数**，规则可单独测。
 *
 * 四条规则都来自一手实测（见定义 §一 1.2 的规则表）：
 *  ① **类型必须是 `video`** —— 图文的 `music.play_url` 是 BGM，转出来是歌词而不是口播；
 *  ② **音频 URL 得在** —— 解析不到就没什么可转的；
 *  ③ **标题不含排除词** —— 列表项里没有「这是广告」这个字段，只能拿标题猜（**启发式，会误伤**）；
 *  ④ **截断到 `max_items`** —— 服务端的 `count` 只是提示（实测要 5 回来 8、要 10 回来 13），截断只能在客户端做。
 *
 * ⚠️ 顺序是「**先过滤再截断**」：反过来的话，被过滤掉的条目会白占一个名额，
 *    拿到的条数就比 `max_items` 少 —— 那是个很难被发现的静默短缺。
 * ⚠️ 排除词只在这条路径上生效 —— **钉住的视频不查词**：那是作者显式点名的，
 *    他想采就采，代码不替他判断。
 */
export function selectCreatorVideos(
  candidates: VideoCandidate[],
  maxItems: number,
  excludeTitleKeywords: string[] = [],
): VideoCandidate[] {
  return candidates.filter((c) => candidateRejection(c, excludeTitleKeywords) === null).slice(0, maxItems);
}

/** 候选被刷掉的原因（`null` = 留下）。规则表就一份，选片与「挡下了哪几条」共用，不各写一遍。 */
export function candidateRejection(
  c: VideoCandidate,
  excludeTitleKeywords: readonly string[],
): 'kind' | 'no_audio' | 'keyword' | null {
  if (c.kind !== 'video') return 'kind';
  if (c.audio_url === null) return 'no_audio';
  if (excludeTitleKeywords.some((kw) => c.title.includes(kw))) return 'keyword';
  return null;
}

/** 一条已抓到的视频 → 转写 → 落库（两条路径共用，免得同一个 upsert 抄两遍） */
async function persist(
  fetched: FetchedVideo,
  topicDomain: string,
  transcript: Transcript,
  robots: RobotsCheck,
): Promise<IngestedSource> {
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
    topic_domain: topicDomain,
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
    topic_domain: topicDomain,
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

/** 抓一条音频、转写、删音频 —— 三条路径共用的那一段 */
async function transcribeAndDrop(audioPath: string, deps: IngestDeps): Promise<Transcript> {
  try {
    return await deps.asr.transcribe(audioPath);
  } finally {
    await deps.fetcher.discardAudio(audioPath);
  }
}

/** 采一条**钉住**的视频（清单里显式写的那条） */
export async function ingestVideo(
  whitelist: Whitelist,
  deps: IngestDeps,
  key: string,
  robots: RobotsCheck,
): Promise<IngestedSource> {
  const video = assertWhitelisted(whitelist, key);
  const fetched = await deps.fetcher.fetch(video);
  deps.onProgress?.({
    stage: 'transcribe',
    platform_video_key: fetched.platform_video_key,
    title: fetched.title,
    duration_sec: fetched.duration_sec,
  });
  const transcript = await transcribeAndDrop(fetched.audio_path, deps);
  const source = await persist(fetched, video.topic_domain, transcript, robots);
  deps.onProgress?.({
    stage: 'done',
    platform_video_key: fetched.platform_video_key,
    segments: transcript.segments.length,
  });
  return source;
}

/**
 * 采一个**白名单博主**的近期作品。
 *
 * 先列作品（只拿元数据）→ 过规则、截断 → 再逐条下音频。
 * 不先列表就直接下音频的话，会给马上要丢掉的图文白下一遍。
 *
 * `skipKeys` = 本次不该重复采的键（**钉住的视频赢**，见 `ingestAll`）。
 */
export async function ingestCreator(
  whitelist: Whitelist,
  deps: IngestDeps,
  profileUrl: string,
  robots: RobotsCheck,
  skipKeys: ReadonlySet<string> = new Set(),
): Promise<IngestedSource[]> {
  const creator = assertWhitelistedCreator(whitelist, profileUrl);

  const candidates = await deps.fetcher.listCreatorVideos(creator);
  const picked = selectCreatorVideos(
    candidates,
    creator.max_items,
    whitelist.exclude_title_keywords,
    // ⚠️ 跳过放在**截断之后**：钉住的那条若也在列表里，它本来就该占「近 N 条」的一个名额 ——
    //    放到截断之前，总数会超过 `max_items`。
  ).filter((c) => !skipKeys.has(c.platform_video_key));

  deps.onProgress?.({
    stage: 'listed',
    creator: creator.creator,
    candidates: candidates.length,
    picked: picked.length,
    excluded: candidates
      .filter((c) => candidateRejection(c, whitelist.exclude_title_keywords) === 'keyword')
      .map((c) => c.title),
  });

  const sources: IngestedSource[] = [];
  for (const c of picked) {
    // selectCreatorVideos 已保证 audio_url 在，这里只是收窄类型
    if (!c.audio_url) continue;
    deps.onProgress?.({
      stage: 'transcribe',
      platform_video_key: c.platform_video_key,
      title: c.title,
      duration_sec: c.duration_sec,
    });
    const audio_path = await deps.fetcher.downloadAudio(c.audio_url);
    const transcript = await transcribeAndDrop(audio_path, deps);
    sources.push(
      await persist(
        {
          platform_video_key: c.platform_video_key,
          video_id: c.video_id,
          creator: c.creator,
          title: c.title,
          original_url: c.original_url,
          duration_sec: c.duration_sec,
          published_at: c.published_at,
          audio_path,
        },
        creator.topic_domain,
        transcript,
        robots,
      ),
    );
    deps.onProgress?.({
      stage: 'done',
      platform_video_key: c.platform_video_key,
      segments: transcript.segments.length,
    });
  }
  return sources;
}

/**
 * 跑一批。robots 一次检查覆盖整批 —— 它是站点级判定，不是每条视频一次。
 *
 * 顺序：**先遍历博主，再采钉住的视频**。
 * `keys` 只筛钉住那半（遍历走的是白名单里的全部博主）—— 它给测试用。
 *
 * 🔴 **去重规则：同一个视频只采一次，钉住的赢。**
 *    遍历时跳过 `videos` 里的键（那条作者显式点名、带自己的 `topic_domain`，以它为准）；
 *    博主之间也会撞（同一条被两个博主转发）→ 用 `seen` 兜住。
 *    不去重的话，同一条会被下两次音频、转写两次，且后落的那次把前一次的 `topic_domain` 覆盖掉。
 */
export async function ingestAll(
  whitelist: Whitelist,
  deps: IngestDeps,
  keys?: string[],
): Promise<{ robots: RobotsCheck; sources: IngestedSource[] }> {
  const robots = await deps.fetcher.checkRobots();

  const pinnedKeys = new Set(whitelist.videos.map((v) => v.platform_video_key));
  const seen = new Set<string>();
  const sources: IngestedSource[] = [];

  for (const creator of whitelist.creators) {
    const got = await ingestCreator(whitelist, deps, creator.profile_url, robots, pinnedKeys);
    for (const s of got) seen.add(s.platform_video_key);
    sources.push(...got);
  }

  const targets = keys ?? whitelist.videos.map((v) => v.platform_video_key);
  for (const key of targets) {
    if (seen.has(key)) continue;
    sources.push(await ingestVideo(whitelist, deps, key, robots));
  }

  return { robots, sources };
}