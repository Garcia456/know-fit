import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeAsr } from '../asr/fake.js';
import { closeDb, getPool } from '../services/pool.js';
import { retireSource } from '../services/knowledge.js';
import { createFakeFetcher } from './fake.js';
import {
  FIXTURE_CREATOR_WHITELIST,
  FIXTURE_CREATORS,
  FIXTURE_WHITELIST,
  fixtureCandidates,
} from './fixtures.js';
import { ingestAll, ingestCreator, ingestVideo, isOriginalSound, selectCreatorVideos } from './pipeline.js';
import { EmptyTranscriptError } from './types.js';
import type { AsrClient, Fetcher, RobotsCheck } from './types.js';

/**
 * 采集 → 转写 → 落库的编排 —— 与图测试相反：这里**必须连真库**。
 *
 * 读回用裸 SQL 而不是 ORM：拿同一套映射读回来只证明「映射自洽」，
 * 证不了「表里真是这么写的」。
 *
 * ⚠️ 走的是**替身**（不联网、不加载模型），所以本文件只证明「管道通」。
 *    「抖音解析对」「转写准」只能由作者本机 kb:smoke 回答。
 *
 * 前置：pnpm db:up && pnpm db:migrate。自清理：用 fixture- 前缀，测完即删。
 */

const KEYS: [string, string] = [
  FIXTURE_WHITELIST.videos[0]!.platform_video_key,
  FIXTURE_WHITELIST.videos[1]!.platform_video_key,
];
/** 替身转写里的正文片段 —— 用来断言它**没有**漏进对外契约 */
const BODY_FRAGMENT = '肩胛要收紧';
const ROBOTS: RobotsCheck = { checked_at: new Date('2026-10-14T09:00:00.000Z'), allowed: null };

beforeAll(async () => {
  try {
    await getPool().query('SELECT 1');
  } catch (e) {
    throw new Error(
      `连不上数据库 —— 本测试要真库：pnpm db:up && pnpm db:migrate。原始错误：${(e as Error).message}`,
      { cause: e },
    );
  }
});

afterAll(async () => {
  await getPool().query("DELETE FROM knowledge_source WHERE platform_video_key LIKE 'fixture-%'");
  await closeDb();
});

const deps = () => ({ fetcher: createFakeFetcher(), asr: createFakeAsr() });

describe('ingestAll：一批采完能读回来', () => {
  it('每条源都落了行，元数据与留痕字段齐全', async () => {
    const { robots, sources } = await ingestAll(FIXTURE_WHITELIST, deps(), KEYS);

    expect(robots.checked_at).toBeInstanceOf(Date);
    expect(sources).toHaveLength(2);

    for (const s of sources) {
      expect(s.platform).toBe('douyin');
      expect(s.subtitle_source).toBe('asr');
      expect(s.is_indexable).toBe(true);
      expect(s.compliance_status).toBe('ok');
      // 替身转写第一段是空段，归一后被丢掉 → 3 段落 2 段
      expect(s.segment_count).toBe(2);
      expect(s.robots_checked_at).toBe('2026-10-14T09:00:00.000Z');
      expect(typeof s.fetched_at).toBe('string');
    }

    // 裸 SQL 读回来 —— 证「表里真是这么写的」
    const rows = await getPool().query(
      `SELECT platform, subtitle_source, is_indexable, robots_checked_at, robots_allowed,
              jsonb_array_length(transcript_segments) AS seg_count,
              transcript_segments -> 0 ->> 'text' AS first_text
         FROM knowledge_source WHERE platform_video_key = $1`,
      [KEYS[0]],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].platform).toBe('douyin');
    expect(rows.rows[0].is_indexable).toBe(true);
    expect(Number(rows.rows[0].seg_count)).toBe(2);
    // 留痕是「检查过」这个动作的证词，不能为空
    expect(rows.rows[0].robots_checked_at).not.toBeNull();
    // 替身测出的结论是 null（检查过，结论不适用）—— 那一列本身允许为空
    expect(rows.rows[0].robots_allowed).toBeNull();
    expect(rows.rows[0].first_text).toContain(BODY_FRAGMENT);
  });

  it('content_hash 落了 64 位十六进制 —— 下架时按内容定位的锚', async () => {
    await ingestAll(FIXTURE_WHITELIST, deps(), [KEYS[0]]);
    const rows = await getPool().query(
      'SELECT content_hash FROM knowledge_source WHERE platform_video_key = $1',
      [KEYS[0]],
    );
    expect(rows.rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('🔴 重采同一条是更新不是新增 —— 库里「有多少料」这个数字不失真', async () => {
    await ingestAll(FIXTURE_WHITELIST, deps(), [KEYS[0]]);
    const first = await getPool().query(
      'SELECT id FROM knowledge_source WHERE platform_video_key = $1',
      [KEYS[0]],
    );
    await ingestAll(FIXTURE_WHITELIST, deps(), [KEYS[0]]);
    const second = await getPool().query(
      'SELECT id FROM knowledge_source WHERE platform_video_key = $1',
      [KEYS[0]],
    );
    expect(second.rowCount).toBe(1);
    expect(second.rows[0].id).toBe(first.rows[0].id);
  });

  it('🔴 对外契约里没有转写正文 —— 只有元数据与计数', async () => {
    const { sources } = await ingestAll(FIXTURE_WHITELIST, deps(), KEYS);
    const serialized = JSON.stringify(sources);
    expect(serialized).not.toContain(BODY_FRAGMENT);
    // 但计数要在 —— 「有几段」可报，「是哪几段」不可报
    expect(sources[0]!.segment_count).toBe(2);
  });
});

describe('ingestVideo：准入判定在最前面', () => {
  it('🔴 不在白名单的视频被拒 —— 且解析端根本没被碰过', async () => {
    let touched = false;
    const spy: Fetcher = {
      async fetch() {
        touched = true;
        throw new Error('不该走到解析这一步');
      },
      async listCreatorVideos() {
        touched = true;
        throw new Error('不该走到遍历这一步');
      },
      async downloadAudio() {
        touched = true;
        throw new Error('不该走到下载这一步');
      },
      checkRobots: () => createFakeFetcher().checkRobots(),
      discardAudio: async () => {},
    };

    await expect(
      ingestVideo(FIXTURE_WHITELIST, { fetcher: spy, asr: createFakeAsr() }, 'dy-未在清单', ROBOTS),
    ).rejects.toThrow(/不在白名单里/);
    // 先抓再判 = 「先碰了内容再决定要不要碰」，那正是长成爬虫的第一步
    expect(touched).toBe(false);
  });
});

describe('selectCreatorVideos：五条规则，且顺序不能反', () => {
  const candidates = fixtureCandidates(FIXTURE_CREATORS[0]!);
  const KW = FIXTURE_CREATOR_WHITELIST.exclude_title_keywords;
  const keys = (cs: { platform_video_key: string }[]) => cs.map((c) => c.platform_video_key);

  it('替代样本本身长成预期的样子（0 图文 / 2 无音频 / 5 推广片 / 6 配乐片 / 7 缺一信号 / 其余可采）', () => {
    expect(keys(candidates)).toEqual([
      'fixture-cand-0',
      'fixture-cand-1',
      'fixture-cand-2',
      'fixture-cand-3',
      'fixture-cand-4',
      'fixture-cand-5',
      'fixture-cand-6',
      'fixture-cand-7',
    ]);
  });

  it('🔴 先过滤再截断：被过滤的条目**不占** max_items 的名额', () => {
    // 第 0 条是图文（有 BGM）、第 2 条没音频；先截断的话 max_items=2 只会剩 cand-0/cand-1 → 采到 1 条
    expect(keys(selectCreatorVideos(candidates, 2, KW))).toEqual(['fixture-cand-1', 'fixture-cand-3']);
  });

  it('kind != video 的条目被滤掉（图文的 BGM 不是口播）', () => {
    expect(keys(selectCreatorVideos(candidates, 99, KW))).not.toContain('fixture-cand-0');
  });

  it('没有 audio_url 的条目被滤掉', () => {
    expect(keys(selectCreatorVideos(candidates, 99, KW))).not.toContain('fixture-cand-2');
  });

  it('🔴 标题命中排除词的条目被滤掉（推广片）', () => {
    expect(keys(selectCreatorVideos(candidates, 99, KW))).not.toContain('fixture-cand-5');
    // 不给词表就挡不住 —— 这条同时证明「拦的是词表，不是别的什么」
    expect(keys(selectCreatorVideos(candidates, 99, []))).toContain('fixture-cand-5');
  });

  it('排除词是「包含」判定，不是全等（推广片的标题往往更长）', () => {
    const kw = ['宠粉'];
    expect(keys(selectCreatorVideos(candidates, 99, kw))).not.toContain('fixture-cand-5');
  });

  it('🔴 配乐片被滤掉 —— 挂配乐时 `music.play_url` 指的是那首歌，不是视频原声', () => {
    expect(keys(selectCreatorVideos(candidates, 99, KW))).not.toContain('fixture-cand-6');
  });

  it('🔴 原声判定两个信号取 AND：文案对、时长对不上 → 照样滤掉', () => {
    expect(keys(selectCreatorVideos(candidates, 99, KW))).not.toContain('fixture-cand-7');
  });

  it('🔴 两个信号缺一即跳 —— 只对上一个不算原声（宁可留配乐片，不误杀真原声）', () => {
    const base = candidates.find((c) => c.platform_video_key === 'fixture-cand-1')!;
    // 只有时长比对上、文案不是原声标
    expect(isOriginalSound({ ...base, music_title: 'Soul Food' })).toBe(false);
    // 只有文案对上、时长比值离谱
    expect(isOriginalSound({ ...base, music_duration_ms: 170000 })).toBe(false);
    // 两个都缺（平台没给 music 那两块）→ 不采
    expect(isOriginalSound({ ...base, music_title: null, music_duration_ms: null })).toBe(false);
    // 两个都在 → 采
    expect(isOriginalSound(base)).toBe(true);
  });

  it('🔴 时长比取「未取整的毫秒」:80734ms 对 80000ms 比值 0.991 该**通过**，取整成秒就掉到 0.988 误杀', () => {
    const short = { ...candidates.find((c) => c.platform_video_key === 'fixture-cand-1')!, duration_ms: 80734 };
    expect(isOriginalSound({ ...short, music_duration_ms: 80000 })).toBe(true);
    // 若拿取整后的秒算（81s vs 80s = 0.988）它就会被误杀 —— 这条钉住「用毫秒」
    expect(80000 / (short.duration_sec! * 1000)).toBeLessThan(0.99);
  });

  it('max_items 是上限，不放大', () => {
    expect(selectCreatorVideos(candidates, 99, KW)).toHaveLength(3);
    expect(selectCreatorVideos(candidates, 1, KW)).toHaveLength(1);
    expect(selectCreatorVideos(candidates, 0, KW)).toHaveLength(0);
  });

  it('空候选 → 空结果（新博主还没发视频，不是错误）', () => {
    expect(selectCreatorVideos([], 10, KW)).toEqual([]);
  });
});

describe('ingestCreator：遍历一个白名单博主', () => {
  it('采回的条数 = 过规则后截到 max_items，落库字段齐全', async () => {
    const sources = await ingestCreator(
      FIXTURE_CREATOR_WHITELIST,
      deps(),
      FIXTURE_CREATORS[0]!.profile_url,
      ROBOTS,
    );
    // max_items = 2 且候选里有两条不可采 → 正好 cand-1 / cand-3
    expect(sources.map((s) => s.platform_video_key)).toEqual([
      'fixture-cand-1',
      'fixture-cand-3',
    ]);
    for (const s of sources) {
      expect(s.platform).toBe('douyin');
      expect(s.topic_domain).toBe('训练动作');
      expect(s.subtitle_source).toBe('asr');
      expect(s.is_indexable).toBe(true);
      expect(s.segment_count).toBe(2);
    }

    const rows = await getPool().query(
      `SELECT platform_video_key, topic_domain, jsonb_array_length(transcript_segments) AS seg_count
         FROM knowledge_source WHERE platform_video_key LIKE 'fixture-cand-%'
        ORDER BY platform_video_key`,
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.map((r) => r.platform_video_key)).toEqual([
      'fixture-cand-1',
      'fixture-cand-3',
    ]);
    expect(Number(rows.rows[0].seg_count)).toBe(2);
  });

  it('🔴 挡下的标题要如实报出来 —— 定义 §3.1 第 5 条靠它肉眼复查有没有误杀', async () => {
    const listed: string[][] = [];
    await ingestCreator(
      FIXTURE_CREATOR_WHITELIST,
      { ...deps(), onProgress: (e) => { if (e.stage === 'listed') listed.push(e.excluded); } },
      FIXTURE_CREATORS[0]!.profile_url,
      ROBOTS,
    );
    // 候选里只有 cand-5 命中词表（「宠粉福利 送手表」）—— 图文与无音频的不算「被排除词挡下」
    expect(listed).toEqual([['宠粉福利 送手表']]);
  });

  it('🔴 配乐片挡下哪几条要报出来 —— 与排除词同层、同一个 `listed` 事件', async () => {
    const music: string[][] = [];
    await ingestCreator(
      FIXTURE_CREATOR_WHITELIST,
      { ...deps(), onProgress: (e) => { if (e.stage === 'listed') music.push(e.music_excluded); } },
      FIXTURE_CREATORS[0]!.profile_url,
      ROBOTS,
    );
    // cand-6（挂了配乐）与 cand-7（缺一信号）都该在这里，且各自只算一次
    expect(music).toEqual([['替身候选 6', '替身候选 7']]);
  });

  it('🔴 空转写不中止整批：那条跳过、后面的照跑，且跳过被记进 `skipped`', async () => {
    // 让 cand-1 那条吐空转写 —— 它是**第一条**，若还抛穿整批，cand-3 就采不到了
    const emptyFor = '/tmp/knowfit-fixture-cand-1.mp3';
    const flakyAsr: AsrClient = {
      async transcribe(audioPath) {
        if (audioPath === emptyFor)
          throw new EmptyTranscriptError('转写归一后一段不剩 —— 要么取错了音轨，要么模型没正常工作。');
        return createFakeAsr().transcribe(audioPath);
      },
    };

    // 本文件前面的用例已经落过 cand-1 → 用「前后行数」判有没有新写，而不是「行数是不是 0」
    const countCand1 = async (): Promise<number> =>
      (
        await getPool().query(
          `SELECT 1 FROM knowledge_source WHERE platform_video_key = 'fixture-cand-1'`,
        )
      ).rowCount ?? 0;
    const before = await countCand1();

    const { sources, skipped } = await ingestAll(
      {
        $schema_version: '1',
        creators: FIXTURE_CREATORS,
        videos: [],
        exclude_title_keywords: FIXTURE_CREATOR_WHITELIST.exclude_title_keywords,
      },
      { ...deps(), asr: flakyAsr },
    );

    // 坏片后面的那条照采 —— 这正是「一次坏片不许放大成整批失败」
    expect(sources.map((s) => s.platform_video_key)).toEqual(['fixture-cand-3']);
    // 跳过要留痕：调用方据此让退出码非零（否则「少一条」与「本来没这条」长得一样）
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.platform_video_key).toBe('fixture-cand-1');
    expect(skipped[0]!.reason).toMatch(/一段不剩/);

    // 空源仍然没进库 —— 行数没长
    expect(await countCand1()).toBe(before);
  });

  it('🔴 只接「空转写」这一类错：ASR 进程挂了（系统性问题）必须抛穿，不许当跳过', async () => {
    const brokenAsr: AsrClient = {
      async transcribe() {
        throw new Error('起不了 ASR 进程 —— 本机装好 faster-whisper 了吗？');
      },
    };
    await expect(
      ingestCreator(
        FIXTURE_CREATOR_WHITELIST,
        { ...deps(), asr: brokenAsr },
        FIXTURE_CREATORS[0]!.profile_url,
        ROBOTS,
      ),
    ).rejects.toThrow(/起不了 ASR 进程/);
  });

  it('🔴 不在白名单的主页被拒 —— 且列表端根本没被碰过', async () => {
    let touched = false;
    const spy: Fetcher = {
      async fetch() {
        throw new Error('不该走到解析这一步');
      },
      async listCreatorVideos() {
        touched = true;
        throw new Error('不该走到遍历这一步');
      },
      async downloadAudio() {
        throw new Error('不该走到下载这一步');
      },
      checkRobots: () => createFakeFetcher().checkRobots(),
      discardAudio: async () => {},
    };

    await expect(
      ingestCreator(
        FIXTURE_CREATOR_WHITELIST,
        { fetcher: spy, asr: createFakeAsr() },
        'https://www.douyin.com/user/别的主页',
        ROBOTS,
      ),
    ).rejects.toThrow(/不在白名单里/);
    expect(touched).toBe(false);
  });

  it('ingestAll 先遍历博主、再采钉住的视频（两半相加）', async () => {
    const { sources } = await ingestAll({
      $schema_version: '1',
      creators: FIXTURE_CREATORS,
      videos: [FIXTURE_WHITELIST.videos[0]!],
      exclude_title_keywords: FIXTURE_CREATOR_WHITELIST.exclude_title_keywords,
    }, deps());
    expect(sources.map((s) => s.platform_video_key)).toEqual([
      'fixture-cand-1',
      'fixture-cand-3',
      'fixture-0001',
    ]);
  });

  it('🔴 去重：同一条既在遍历结果里、又被钉住 → 只采一次，**钉住的赢**', async () => {
    // 遍历本会取到 cand-1；把它同时钉住 —— 若不去重，它会下两次音频、转写两次
    const { sources } = await ingestAll(
      {
        $schema_version: '1',
        creators: FIXTURE_CREATORS,
        videos: [
          {
            platform_video_key: 'fixture-cand-1',
            creator: '替身博主甲',
            title: '钉住的替身候选',
            original_url: 'https://www.douyin.com/video/fixture-cand-1',
            topic_domain: '钉住域',
          },
        ],
        exclude_title_keywords: FIXTURE_CREATOR_WHITELIST.exclude_title_keywords,
      },
      deps(),
    );
    expect(sources.map((s) => s.platform_video_key)).toEqual(['fixture-cand-3', 'fixture-cand-1']);
    // 钉住的那条带自己的 topic_domain → 库里该是「钉住域」，不是遍历那半的「训练动作」
    const rows = await getPool().query(
      'SELECT topic_domain FROM knowledge_source WHERE platform_video_key = $1',
      ['fixture-cand-1'],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].topic_domain).toBe('钉住域');
  });
});

describe('retireSource：下架要清产物、留行', () => {
  it('转写段落清空、is_indexable 转 false，行本身留着（留痕）', async () => {
    const { sources } = await ingestAll(FIXTURE_WHITELIST, deps(), [KEYS[1]]);
    const target = sources[0]!;

    const report = await retireSource(target.source_id);
    expect(report.segments_before).toBe(2);
    expect(report.segments_after).toBe(0);
    expect(report.compliance_status).toBe('retired');
    expect(report.is_indexable).toBe(false);
    // 可检索源少了一条 —— 用前后差而不是绝对值，免得被库里别的行干扰
    expect(report.sources_before - report.sources_after).toBe(1);

    const rows = await getPool().query(
      'SELECT is_indexable, compliance_status, transcript_segments, content_hash FROM knowledge_source WHERE id = $1',
      [target.source_id],
    );
    expect(rows.rowCount).toBe(1); // 行保留 = 下架过什么可被指认
    expect(rows.rows[0].is_indexable).toBe(false);
    expect(rows.rows[0].compliance_status).toBe('retired');
    expect(rows.rows[0].transcript_segments).toBeNull();
    // 锚还在：内容清掉了，但「清掉的是哪条」仍可指认
    expect(rows.rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('下架不存在的 id → 抛', async () => {
    await expect(retireSource('00000000-0000-4000-8000-00000000dead')).rejects.toThrow(
      /没有 id/,
    );
  });
});