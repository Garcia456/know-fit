import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WhitelistSchema, type Creator, type Whitelist, type WhitelistVideo } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 白名单文件路径（随 api 包一起走，与 seed/exercises.json 同型） */
export const WHITELIST_PATH = join(HERE, '..', '..', 'seed', 'knowledge_whitelist.json');

/**
 * 校验并归一白名单。
 *
 * 除了 Zod 的结构校验，还查**重复** —— 博主查 `profile_url`、视频查 `platform_video_key`。
 * 重复不会让 JSON 坏掉，但会让同一个东西被采两次、库里撞唯一约束，
 * 且症状出现在落库那一刻，离病因很远。
 */
export function parseWhitelist(raw: unknown): Whitelist {
  const whitelist = WhitelistSchema.parse(raw);

  const seenUrls = new Set<string>();
  const dupeUrls: string[] = [];
  for (const c of whitelist.creators) {
    if (seenUrls.has(c.profile_url)) dupeUrls.push(c.profile_url);
    seenUrls.add(c.profile_url);
  }
  if (dupeUrls.length) {
    throw new Error(`白名单里有重复的 profile_url：\n  ${dupeUrls.join('\n  ')}`);
  }

  const seenKeys = new Set<string>();
  const dupes: string[] = [];
  for (const v of whitelist.videos) {
    if (seenKeys.has(v.platform_video_key)) dupes.push(v.platform_video_key);
    seenKeys.add(v.platform_video_key);
  }
  if (dupes.length) {
    throw new Error(`白名单里有重复的 platform_video_key：\n  ${dupes.join('\n  ')}`);
  }
  return whitelist;
}

export function loadWhitelist(path: string = WHITELIST_PATH): Whitelist {
  return parseWhitelist(JSON.parse(readFileSync(path, 'utf8')));
}

/** 清单是不是空的 —— 两半都空才是空（采集真跑前的第一道自检） */
export function isWhitelistEmpty(whitelist: Whitelist): boolean {
  return whitelist.creators.length === 0 && whitelist.videos.length === 0;
}

/**
 * `KB_CREATOR=<博主名>` —— 本次只跑这一位；不传就原样返回。
 *
 * 名字按白名单里的 `creator` 字段**全等**匹配（同一个人的主页和钉住视频都算）。
 * ⚠️ 找不到是配置错，抛出来 —— 静默跑成空清单等于「今天什么都没采」却看不出来。
 */
export function scopeWhitelistToCreator(
  whitelist: Whitelist,
  creatorName: string | undefined,
): Whitelist {
  const name = creatorName?.trim();
  if (!name) return whitelist;

  const creators = whitelist.creators.filter((c) => c.creator === name);
  const videos = whitelist.videos.filter((v) => v.creator === name);
  if (creators.length === 0 && videos.length === 0) {
    const known = [...whitelist.creators.map((c) => c.creator), ...whitelist.videos.map((v) => v.creator)];
    throw new Error(
      `KB_CREATOR=「${name}」不在白名单里 —— 现有：${[...new Set(known)].join(' / ') || '（空）'}`,
    );
  }
  return { ...whitelist, creators, videos };
}

/** 在不在白名单里 —— 采集的准入判定，只有这一个入口 */
export function assertWhitelisted(whitelist: Whitelist, key: string): WhitelistVideo {
  const hit = whitelist.videos.find((v) => v.platform_video_key === key);
  if (!hit) {
    throw new Error(
      `「${key}」不在白名单里 —— 采集只认显式清单，没有「发现」这个动作。` +
        `要么把它加进 knowledge_whitelist.json，要么别采。`,
    );
  }
  return hit;
}

/**
 * 这个主页在不在白名单里 —— 遍历的准入判定。
 *
 * 🔴 与 `assertWhitelisted` 同一件事，只是管的是**博主**这一层：
 * 入口只认白名单里那几条主页，**不认「任意主页」**（那才是「发现」）。
 */
export function assertWhitelistedCreator(whitelist: Whitelist, profileUrl: string): Creator {
  const hit = whitelist.creators.find((c) => c.profile_url === profileUrl);
  if (!hit) {
    throw new Error(
      `「${profileUrl}」这个主页不在白名单里 —— 只遍历你显式授权的博主，` +
        `不顺着推荐 / 搜索 / 别人的主页走。`,
    );
  }
  return hit;
}