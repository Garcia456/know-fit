import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WhitelistSchema, type Whitelist, type WhitelistVideo } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 白名单文件路径（随 api 包一起走，与 seed/exercises.json 同型） */
export const WHITELIST_PATH = join(HERE, '..', '..', 'seed', 'knowledge_whitelist.json');

/**
 * 校验并归一白名单。
 *
 * 除了 Zod 的结构校验，还查**重复的 platform_video_key** ——
 * 重复键不会让 JSON 坏掉，但会让同一条视频被采两次、库里撞唯一约束，
 * 且症状出现在落库那一刻，离病因很远。
 */
export function parseWhitelist(raw: unknown): Whitelist {
  const whitelist = WhitelistSchema.parse(raw);

  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const v of whitelist.videos) {
    if (seen.has(v.platform_video_key)) dupes.push(v.platform_video_key);
    seen.add(v.platform_video_key);
  }
  if (dupes.length) {
    throw new Error(`白名单里有重复的 platform_video_key：\n  ${dupes.join('\n  ')}`);
  }
  return whitelist;
}

export function loadWhitelist(path: string = WHITELIST_PATH): Whitelist {
  return parseWhitelist(JSON.parse(readFileSync(path, 'utf8')));
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