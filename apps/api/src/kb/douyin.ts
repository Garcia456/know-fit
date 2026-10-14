import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { isDisallowedAll } from './robots.js';
import type { Fetcher, WhitelistVideo } from './types.js';

/**
 * 真实采集 —— 走**自建解析服务**（含签名解析的第三方实现），
 * 🔴 **本模块不自己重写签名算法**，只调它的 REST。
 *
 * ⚠️ 这条路径**只在作者本机跑，永不进 CI**：它要联网、要那个服务起着。
 *   CI 里跑的是同接口的替身（kb/fake.ts）。
 *
 * 🔴 解析结果的**层级会随上游版本漂移**，所以下面按**语义找**而不是按固定路径读：
 *   找 `music.play_url`（这一条作者已一手实测是人声轨）、找视频 id / 标题 / 时长，
 *   任一找不到就退回白名单里的值 —— **白名单才是权威标签**，解析只补参数。
 */

/** 解析服务基址 —— 例：http://127.0.0.1:8080（见 .env.example） */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';

/** 抖音 robots.txt —— 无论结论如何都要记一笔 checked_at */
const ROBOTS_URL = 'https://www.douyin.com/robots.txt';

/** 遍历整棵树找第一个命中的键 —— 上游层级漂移时不会立刻断掉 */
function findFirst(json: unknown, keys: string[]): unknown {
  const stack: unknown[] = [json];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'string' && v) return v;
      if (typeof v === 'number') return v;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return undefined;
}

/** 🔴 抓音频的唯一依据 —— 作者已一手实测 `music.play_url` 是视频原声（人声轨） */
export function findMusicPlayUrl(json: unknown): string | null {
  const stack: unknown[] = [json];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const music = obj.music;
    if (music && typeof music === 'object') {
      const url = (music as Record<string, unknown>).play_url;
      if (typeof url === 'string' && url.startsWith('http')) return url;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

function asSeconds(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  // 抖音的时长字段是毫秒 —— 超过一小时的值按毫秒打折
  return v > 3600 ? Math.round(v / 1000) : Math.round(v);
}

function asIsoDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return new Date(v * 1000).toISOString();
  }
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export interface DouyinFetcherOptions {
  baseUrl?: string;
  /** 音频落地的临时目录；缺省用系统临时目录 */
  tmpRoot?: string;
}

export function createDouyinFetcher(opts: DouyinFetcherOptions = {}): Fetcher {
  const baseUrl = (opts.baseUrl ?? process.env.KB_PARSER_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );
  const tmpRoot = opts.tmpRoot ?? tmpdir();

  return {
    async checkRobots() {
      const checked_at = new Date();
      try {
        const res = await fetch(ROBOTS_URL, { redirect: 'follow' });
        if (!res.ok) return { checked_at, allowed: null };
        return { checked_at, allowed: !isDisallowedAll(await res.text()) };
      } catch {
        // 拿不到 robots.txt 不等于「允许」—— 记 null（检查过，结论不适用）
        return { checked_at, allowed: null };
      }
    },

    async fetch(video: WhitelistVideo) {
      const endpoint = `${baseUrl}/api/hybrid/video_data?url=${encodeURIComponent(video.original_url)}&minimal=true`;
      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error(`解析服务返回 HTTP ${res.status}（${endpoint}）—— 服务起着吗？Cookie 配了吗？`);
      }
      const json: unknown = await res.json();

      const audioUrl = findMusicPlayUrl(json);
      if (!audioUrl) {
        throw new Error(
          '解析结果里找不到 music.play_url —— 上游返回的层级可能变了（先看 kb:smoke 打出来的键）',
        );
      }

      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) throw new Error(`音频下载失败：HTTP ${audioRes.status}`);
      const buf = Buffer.from(await audioRes.arrayBuffer());

      const dir = await mkdtemp(join(tmpRoot, 'knowfit-audio-'));
      const ext = extname(new URL(audioUrl).pathname) || '.m4a';
      const audio_path = join(dir, `audio${ext}`);
      await writeFile(audio_path, buf);

      const videoId = findFirst(json, ['aweme_id', 'video_id', 'awemeId']);
      return {
        platform_video_key: video.platform_video_key,
        video_id: typeof videoId === 'string' ? videoId : video.platform_video_key,
        // 解析拿不到就用白名单的标签 —— 白名单是权威，解析只补参数
        creator: (findFirst(json, ['nickname']) as string) ?? video.creator,
        title: (findFirst(json, ['desc', 'title']) as string) ?? video.title,
        original_url: video.original_url,
        duration_sec: asSeconds(findFirst(json, ['duration', 'video_duration'])),
        published_at: asIsoDate(findFirst(json, ['create_time', 'createTime'])),
        audio_path,
      };
    },

    async discardAudio(path: string) {
      const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
      if (dir) await rm(dir, { recursive: true, force: true });
    },
  };
}