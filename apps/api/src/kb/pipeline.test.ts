import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeAsr } from '../asr/fake.js';
import { closeDb, getPool } from '../services/pool.js';
import { retireSource } from '../services/knowledge.js';
import { createFakeFetcher } from './fake.js';
import { FIXTURE_WHITELIST } from './fixtures.js';
import { ingestAll, ingestVideo } from './pipeline.js';
import type { Fetcher, RobotsCheck } from './types.js';

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