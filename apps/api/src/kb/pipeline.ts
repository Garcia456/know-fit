import { upsertSource } from '../services/knowledge.js';
import { assertWhitelisted, assertWhitelistedCreator } from './whitelist.js';
import { EmptyTranscriptError } from './types.js';
import type { IngestedSource } from '../contracts/knowledge.js';
import type {
  AsrClient,
  Fetcher,
  FetchedVideo,
  IngestSkip,
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
      /** 被**原声判定**（规则 ④）挡下的标题 —— 同上，这是预期内的剔除，看一眼有没有误杀真原声 */
      music_excluded: string[];
    }
  | { stage: 'transcribe'; platform_video_key: string; title: string; duration_sec: number | null }
  | { stage: 'done'; platform_video_key: string; segments: number }
  | { stage: 'skipped'; platform_video_key: string; title: string; reason: string };

const iso = (d: Date): string => d.toISOString();

/**
 * 遍历回来的候选 → 真正要采的那几条。**纯函数**，规则可单独测。
 *
 * 五条规则都来自一手实测（见定义 §一 1.2 的规则表）：
 *  ① **类型必须是 `video`** —— 图文的 `music.play_url` 是 BGM，转出来是歌词而不是口播；
 *  ② **音频 URL 得在** —— 解析不到就没什么可转的；
 *  ③ **标题不含排除词** —— 列表项里没有「这是广告」这个字段，只能拿标题猜（**启发式，会误伤**）；
 *  ④ **音频必须是「原声」** —— 博主挂授权配乐时 `music.play_url` 指的是**那首歌**（ADR-033）；
 *  ⑤ **截断到 `max_items`** —— 服务端的 `count` 只是提示（实测要 5 回来 8、要 10 回来 13），截断只能在客户端做。
 *
 * ⚠️ 顺序是「**先过滤再截断**」：反过来的话，被过滤掉的条目会白占一个名额，
 *    拿到的条数就比 `max_items` 少 —— 那是个很难被发现的静默短缺。
 * ⚠️ 排除词与原声判定只在这条路径上生效 —— **钉住的视频不查**：那是作者显式点名的，
 *    他想采就采，代码不替他判断；钉住的真是配乐片，由「空转写跳过」接住。
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
): 'kind' | 'no_audio' | 'keyword' | 'music' | null {
  if (c.kind !== 'video') return 'kind';
  if (c.audio_url === null) return 'no_audio';
  if (excludeTitleKeywords.some((kw) => c.title.includes(kw))) return 'keyword';
  if (!isOriginalSound(c)) return 'music';
  return null;
}

/** 抖音给「原声」打的来源标签 —— 实测原声片一律长这样（`@谭成义创作的原声`） */
const ORIGINAL_SOUND_MARK = '创作的原声';

/** 音轨时长与视频时长的**比值容差** —— 平台把 `music.duration_ms` 取整到秒，短片上这点误差占得更多 */
const DURATION_RATIO_MIN = 0.99;
const DURATION_RATIO_MAX = 1.01;

/**
 * 这条的音频是不是**视频自己的音轨**（而不是博主挂的授权配乐）。
 *
 * 🔴 **两个信号取 AND，不取或**：
 *    ① `music.title` 含「创作的原声」—— 抖音标的来源文案，**直接但会漂移**；
 *    ② `music.duration_ms / duration_ms` 落在 0.99–1.01 —— 原声按视频截断，两者同长；是它的**代理**。
 *
 * ⚠️ **宁可留一条配乐片，不误杀一条真原声**：配乐片后面还有「空转写跳过」兜着，
 *    而误杀是真丢内容。所以缺任一信号就判**不是**原声 —— 这就是「缺一即跳」的口径。
 * ⚠️ 已知敞口：**很短的视频**（<50s）上，平台把配乐时长取整到秒的误差会挤进容差。
 */
export function isOriginalSound(c: VideoCandidate): boolean {
  if (!c.music_title || !c.music_title.includes(ORIGINAL_SOUND_MARK)) return false;
  if (c.duration_ms === null || c.music_duration_ms === null) return false;
  if (c.duration_ms <= 0) return false;
  const ratio = c.music_duration_ms / c.duration_ms;
  return ratio >= DURATION_RATIO_MIN && ratio <= DURATION_RATIO_MAX;
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

/**
 * 抓一条音频、转写、删音频 —— 三条路径共用的那一段。
 *
 * 🔴 **空转写在这里被拦住并转成「跳过」**（ADR-033 决定②）：
 *    空源仍不许入库（空知识源比没有更糟），但**不许抛穿整批** ——
 *    配乐片 / 纯图片 / 模型空转都是**单条的正常坏法**，一次坏片不该让后面几条根本没机会跑。
 *    ⚠️ 只接 `EmptyTranscriptError`：**ASR 进程挂了是另一回事**（系统性问题），必须抛穿。
 * ⚠️ 音频照旧在 `finally` 里删 —— **跳过的那条也不留音频**。
 */
async function transcribeAndDrop(
  audioPath: string,
  deps: IngestDeps,
  ref: { platform_video_key: string; title: string },
): Promise<Transcript | null> {
  try {
    return await deps.asr.transcribe(audioPath);
  } catch (e) {
    if (e instanceof EmptyTranscriptError) {
      deps.onProgress?.({ stage: 'skipped', ...ref, reason: e.message });
      return null;
    }
    throw e;
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
): Promise<IngestedSource | null> {
  const video = assertWhitelisted(whitelist, key);
  const fetched = await deps.fetcher.fetch(video);
  deps.onProgress?.({
    stage: 'transcribe',
    platform_video_key: fetched.platform_video_key,
    title: fetched.title,
    duration_sec: fetched.duration_sec,
  });
  const transcript = await transcribeAndDrop(fetched.audio_path, deps, {
    platform_video_key: fetched.platform_video_key,
    title: fetched.title,
  });
  if (transcript === null) return null;
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
    music_excluded: candidates
      .filter((c) => candidateRejection(c, whitelist.exclude_title_keywords) === 'music')
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
    const transcript = await transcribeAndDrop(audio_path, deps, {
      platform_video_key: c.platform_video_key,
      title: c.title,
    });
    if (transcript === null) continue;
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
 *
 * 🔴 `skipped` 一并返回（ADR-033 决定②）：**跳过即「采集不完整」** ——
 *    调用方据此让**退出码非零**。不返回它的话，「跳过一条」与「本来就没这条」
 *    在退出码上长得一模一样（静默短缺）。它从 `onProgress` 里转手收集，不另开一条回调。
 */
export async function ingestAll(
  whitelist: Whitelist,
  deps: IngestDeps,
  keys?: string[],
): Promise<{ robots: RobotsCheck; sources: IngestedSource[]; skipped: IngestSkip[] }> {
  const robots = await deps.fetcher.checkRobots();

  const skipped: IngestSkip[] = [];
  const inner: IngestDeps = {
    ...deps,
    onProgress: (e) => {
      if (e.stage === 'skipped') {
        skipped.push({
          platform_video_key: e.platform_video_key,
          title: e.title,
          reason: e.reason,
        });
      }
      deps.onProgress?.(e);
    },
  };

  const pinnedKeys = new Set(whitelist.videos.map((v) => v.platform_video_key));
  const seen = new Set<string>();
  const sources: IngestedSource[] = [];

  for (const creator of whitelist.creators) {
    const got = await ingestCreator(whitelist, inner, creator.profile_url, robots, pinnedKeys);
    for (const s of got) seen.add(s.platform_video_key);
    sources.push(...got);
  }

  const targets = keys ?? whitelist.videos.map((v) => v.platform_video_key);
  for (const key of targets) {
    if (seen.has(key)) continue;
    const got = await ingestVideo(whitelist, inner, key, robots);
    if (got) sources.push(got);
  }

  return { robots, sources, skipped };
}