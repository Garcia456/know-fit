import type { Whitelist, WhitelistVideo } from './types.js';

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
  videos: FIXTURE_VIDEOS,
};

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