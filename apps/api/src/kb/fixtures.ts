import type { Creator, VideoCandidate, Whitelist, WhitelistVideo } from './types.js';

/**
 * 替身用的固定样本 —— CI 与测试只走这里，**永不联网、永不加载模型**。
 *
 * ⚠️ 它是**合成数据**：只能证明「管道通」，证明不了「抖音解析对」或「转写准」。
 *    那两件事只能由本地真跑回答（kb:smoke）。
 */

/** 替身认的视频清单 —— 与 seed/knowledge_whitelist.json 无关，CI 不依赖作者填的数据 */
export const FIXTURE_VIDEOS: WhitelistVideo[] = [
  {
    platform_video_key: 'fixture-0001',
    creator: '替身博主甲',
    title: '替身样本：卧推动作拆解',
    original_url: 'https://www.douyin.com/video/fixture-0001',
    topic_domain: '训练动作',
  },
  {
    platform_video_key: 'fixture-0002',
    creator: '替身博主乙',
    title: '替身样本：训练容量怎么算',
    original_url: 'https://www.douyin.com/video/fixture-0002',
    topic_domain: '训练量',
  },
];

export const FIXTURE_WHITELIST: Whitelist = {
  $schema_version: '1',
  creators: [],
  videos: FIXTURE_VIDEOS,
  exclude_title_keywords: [],
};

/** 替身认的博主 —— 遍历路径的用例用它 */
export const FIXTURE_CREATORS: Creator[] = [
  {
    creator: '替身博主甲',
    profile_url: 'https://www.douyin.com/user/fixture-creator-a',
    topic_domain: '训练动作',
    max_items: 2,
  },
];

/** 带博主的白名单 —— 遍历（`creators`）那条路的用例用它 */
export const FIXTURE_CREATOR_WHITELIST: Whitelist = {
  $schema_version: '1',
  creators: FIXTURE_CREATORS,
  videos: [],
  // 替身样本里的第 5 条标题带这个词 → 用来验「排除词真的挡得住」
  exclude_title_keywords: ['宠粉', '福利'],
};

/**
 * 替身遍历回来的候选 —— **刻意混入不能采的条目**，好让那几条规则可测：
 *
 * | # | 类型 | 音频 | 标题 | 应当 |
 * |---|---|---|---|---|
 * | 0 | `image_album` | 有（其实是 BGM） | — | ❌ 被过滤（规则①） |
 * | 1 | `video` | 有 | — | ✅ 采 |
 * | 2 | `video` | **无** | — | ❌ 被过滤（规则②） |
 * | 3 | `video` | 有 | — | ✅ 采 |
 * | 4 | `video` | 有 | — | ✅ 但被 `max_items = 2` 截掉（规则④） |
 * | 5 | `video` | 有 | 带「宠粉福利」 | ❌ 被过滤（规则③） |
 *
 * ⚠️ 第 0 条**故意排在最前**：若先截断再过滤，就会只采到 1 条 ——
 * 「被过滤的条目白占名额」这个静默短缺会立刻暴露。
 * ⚠️ 第 5 条排在**可采的三条之后**：这样「先过滤再截断」的可采集合仍是 1 / 3 / 4，
 * 加了它不影响已有的那几条断言。
 */
export function fixtureCandidates(creator: Creator): VideoCandidate[] {
  const mk = (
    n: number,
    kind: string,
    audio_url: string | null,
    title = `替身候选 ${n}`,
  ): VideoCandidate => ({
    platform_video_key: `fixture-cand-${n}`,
    video_id: `fixture-cand-${n}`,
    creator: creator.creator,
    title,
    original_url: `https://www.douyin.com/video/fixture-cand-${n}`,
    duration_sec: 88,
    published_at: '2026-09-02T10:00:00.000Z',
    kind,
    audio_url,
  });

  return [
    mk(0, 'image_album', 'https://cdn.invalid/fixture-cand-0.mp3'),
    mk(1, 'video', 'https://cdn.invalid/fixture-cand-1.mp3'),
    mk(2, 'video', null),
    mk(3, 'video', 'https://cdn.invalid/fixture-cand-3.mp3'),
    mk(4, 'video', 'https://cdn.invalid/fixture-cand-4.mp3'),
    mk(5, 'video', 'https://cdn.invalid/fixture-cand-5.mp3', '宠粉福利 送手表'),
  ];
}

/** 替身解析出来的元数据 —— 按视频键派生，保证确定性 */
export function fixtureFetched(video: WhitelistVideo) {
  return {
    platform_video_key: video.platform_video_key,
    video_id: video.platform_video_key.replace(/^fixture-/, ''),
    creator: video.creator,
    title: video.title,
    original_url: video.original_url,
    duration_sec: 92,
    published_at: '2026-09-01T10:00:00.000Z',
    audio_path: `/tmp/knowfit-fixture-${video.platform_video_key}.m4a`,
  };
}

/** 替身转写 —— 分段带时间戳，第一段故意是空段（真实 ASR 常吐这种） */
export const FIXTURE_TRANSCRIPT = {
  language: 'zh',
  segments: [
    { start_ts: 0, end_ts: 0.4, text: '', confidence: null },
    {
      start_ts: 0.4,
      end_ts: 6.2,
      text: '卧推的时候肩胛要收紧，先把背贴稳再推，不然肩膀先累。',
      confidence: 0.91,
    },
    {
      start_ts: 6.2,
      end_ts: 12.8,
      text: '重量选在你能标准做完八到十二次的区间，动作变形了就说明重了。',
      confidence: 0.88,
    },
  ],
};

/** 替身测出来的 robots 结论 —— 「检查过，结论是不适用」 */
export const FIXTURE_ROBOTS_CHECKED_AT = new Date('2026-10-14T09:00:00.000Z');