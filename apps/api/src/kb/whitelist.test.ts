import { describe, expect, it } from 'vitest';
import { assertWhitelisted, loadWhitelist, parseWhitelist } from './whitelist.js';

/**
 * 白名单 —— 采集的**唯一准入判定**。
 *
 * 「不在白名单的视频被拒」是这个模块存在的全部理由：采集只认显式清单，
 * 没有「发现」这个动作。没有这条，采集模块迟早长成爬虫。
 */

const VIDEO = {
  platform_video_key: 'dy-0001',
  creator: '某博主',
  title: '卧推动作拆解',
  original_url: 'https://www.douyin.com/video/0001',
  topic_domain: '训练动作',
};

const wrap = (videos: unknown[]) => ({ $schema_version: '1', videos });

describe('parseWhitelist：结构校验', () => {
  it('一条合法清单原样通过', () => {
    const wl = parseWhitelist(wrap([VIDEO]));
    expect(wl.videos).toHaveLength(1);
    expect(wl.videos[0]).toMatchObject({ platform_video_key: 'dy-0001' });
  });

  it('缺字段的视频被拒（original_url 是采的时候唯一要用的东西）', () => {
    const broken = { ...VIDEO, original_url: undefined };
    expect(() => parseWhitelist(wrap([broken]))).toThrow();
  });

  it('🔴 重复的 platform_video_key 被拒 —— 同一条会被采两次，症状出现在落库那刻', () => {
    expect(() => parseWhitelist(wrap([VIDEO, { ...VIDEO }]))).toThrow(/重复/);
  });

  it('空清单合法 —— 仓库里发的就是空的，等作者填', () => {
    expect(parseWhitelist(wrap([])).videos).toEqual([]);
  });
});

describe('assertWhitelisted：唯一的准入入口', () => {
  it('在清单里 → 返回那条（字段就是落库要用的）', () => {
    const hit = assertWhitelisted(parseWhitelist(wrap([VIDEO])), 'dy-0001');
    expect(hit).toMatchObject({ creator: '某博主', topic_domain: '训练动作' });
  });

  it('🔴 不在清单里 → 抛，且报错里说清「没有发现这个动作」', () => {
    expect(() => assertWhitelisted(parseWhitelist(wrap([VIDEO])), 'dy-9999')).toThrow(
      /不在白名单里/,
    );
  });

  it('空清单对着任何键都拒', () => {
    expect(() => assertWhitelisted(parseWhitelist(wrap([])), 'dy-0001')).toThrow(/不在白名单里/);
  });
});

describe('loadWhitelist：仓库里那份真文件能被读出来', () => {
  it('seed/knowledge_whitelist.json 结构合法（v1 发出去时 videos 是空的）', () => {
    // 这条盯的是「文件本身没被手改坏」—— 采集真跑前的第一道自检
    const wl = loadWhitelist();
    expect(Array.isArray(wl.videos)).toBe(true);
    expect(wl.$schema_version).toBe('1');
  });
});