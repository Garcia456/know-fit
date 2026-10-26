import { describe, expect, it } from 'vitest';
import {
  assertWhitelisted,
  assertWhitelistedCreator,
  loadWhitelist,
  parseWhitelist,
  scopeWhitelistToCreator,
} from './whitelist.js';

/**
 * 白名单 —— 采集的**唯一准入判定**。
 *
 * 「不在白名单的视频被拒」是这个模块存在的全部理由：采集只认显式清单，
 * 没有「发现」这个动作。没有这条，采集模块迟早长成爬虫。
 *
 * 博主那一层同理：入口只认清单里那几条主页，**不认「任意主页」**。
 */

const VIDEO = {
  platform_video_key: 'dy-0001',
  creator: '某博主',
  title: '卧推动作拆解',
  original_url: 'https://www.douyin.com/video/0001',
  topic_domain: '训练动作',
};

const CREATOR = {
  creator: '某博主',
  profile_url: 'https://www.douyin.com/user/xxxx',
  topic_domain: '训练动作',
  max_items: 5,
};

const wrap = (videos: unknown[]) => ({ $schema_version: '1', videos });
const wrapCreators = (creators: unknown[], videos: unknown[] = []) => ({
  $schema_version: '1',
  creators,
  videos,
});

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

describe('parseWhitelist：博主那一层', () => {
  it('一条合法博主通过，字段就是遍历要用的', () => {
    const wl = parseWhitelist(wrapCreators([CREATOR]));
    expect(wl.creators).toHaveLength(1);
    expect(wl.creators[0]).toMatchObject({ profile_url: CREATOR.profile_url, max_items: 5 });
  });

  it('max_items 不填 → 默认 10（近 N 条的上限，不是硬限）', () => {
    const noMax = {
      creator: CREATOR.creator,
      profile_url: CREATOR.profile_url,
      topic_domain: CREATOR.topic_domain,
    };
    expect(parseWhitelist(wrapCreators([noMax])).creators[0]!.max_items).toBe(10);
  });

  it('缺 profile_url 的博主被拒（遍历唯一要用的东西）', () => {
    const broken = { ...CREATOR, profile_url: undefined };
    expect(() => parseWhitelist(wrapCreators([broken]))).toThrow();
  });

  it('🔴 重复的 profile_url 被拒 —— 同一个博主的作品会被采两遍', () => {
    expect(() => parseWhitelist(wrapCreators([CREATOR, { ...CREATOR }]))).toThrow(/重复/);
  });

  it('只填博主、videos 不填 → videos 是空数组，不是 undefined', () => {
    const wl = parseWhitelist({ $schema_version: '1', creators: [CREATOR] });
    expect(wl.videos).toEqual([]);
  });

  it('排除词不填 → 空数组（= 不过滤，不是「默认挡点什么」）', () => {
    expect(parseWhitelist(wrapCreators([CREATOR])).exclude_title_keywords).toEqual([]);
  });

  it('空字符串的排除词被拒 —— 空串会「包含」一切，等于把整批全挡掉', () => {
    expect(() =>
      parseWhitelist({ $schema_version: '1', exclude_title_keywords: [''] }),
    ).toThrow();
  });
});

describe('assertWhitelistedCreator：遍历的准入入口', () => {
  it('在清单里 → 返回那条博主', () => {
    const hit = assertWhitelistedCreator(parseWhitelist(wrapCreators([CREATOR])), CREATOR.profile_url);
    expect(hit).toMatchObject({ creator: '某博主', topic_domain: '训练动作' });
  });

  it('🔴 不在清单里的主页 → 抛，且说清「不顺着推荐 / 搜索 / 别人的主页走」', () => {
    expect(() =>
      assertWhitelistedCreator(parseWhitelist(wrapCreators([CREATOR])), 'https://www.douyin.com/user/别的'),
    ).toThrow(/不在白名单里/);
  });

  it('只填了视频、没填博主 → 任何主页都拒（视频比不了主页）', () => {
    expect(() =>
      assertWhitelistedCreator(parseWhitelist(wrap([VIDEO])), CREATOR.profile_url),
    ).toThrow(/不在白名单里/);
  });
});

describe('scopeWhitelistToCreator：KB_CREATOR 只跑一位', () => {
  const other = {
    ...CREATOR,
    creator: '另一位博主',
    profile_url: 'https://www.douyin.com/user/yyyy',
  };
  const wl = parseWhitelist(
    wrapCreators(
      [CREATOR, other],
      [VIDEO, { ...VIDEO, platform_video_key: 'dy-0002', creator: '另一位博主' }],
    ),
  );

  it('不传名字 → 原样返回', () => {
    expect(scopeWhitelistToCreator(wl, undefined)).toBe(wl);
    expect(scopeWhitelistToCreator(wl, '  ')).toBe(wl);
  });

  it('只留这一位的博主与钉住视频（按 creator 全等）', () => {
    const scoped = scopeWhitelistToCreator(wl, '某博主');
    expect(scoped.creators.map((c) => c.profile_url)).toEqual([CREATOR.profile_url]);
    expect(scoped.videos.map((v) => v.platform_video_key)).toEqual(['dy-0001']);
  });

  it('🔴 名字不在清单里 → 抛，不静默跑成空清单', () => {
    expect(() => scopeWhitelistToCreator(wl, '查无此人')).toThrow(/KB_CREATOR=「查无此人」/);
  });
});

describe('loadWhitelist：仓库里那份真文件能被读出来', () => {
  it('seed/knowledge_whitelist.json 结构合法（博主与视频两半都在）', () => {
    // 这条盯的是「文件本身没被手改坏」—— 采集真跑前的第一道自检
    const wl = loadWhitelist();
    expect(Array.isArray(wl.videos)).toBe(true);
    expect(Array.isArray(wl.creators)).toBe(true);
    expect(Array.isArray(wl.exclude_title_keywords)).toBe(true);
    expect(wl.$schema_version).toBe('1');
  });
});