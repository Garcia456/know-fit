import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { isDisallowedAll } from './robots.js';
import type { Creator, Fetcher, VideoCandidate, WhitelistVideo } from './types.js';

/**
 * 真实采集 —— 走**自建解析服务**（含签名解析的第三方实现），
 * 🔴 **本模块不自己重写签名算法**，只调它的 REST。
 *
 * ⚠️ 这条路径**只在作者本机跑，永不进 CI**：它要联网、要那个服务起着、要一个 key。
 *   CI 里跑的是同接口的替身（kb/fake.ts）。
 *
 * 🔴 解析结果的**层级会随上游版本漂移**，所以下面按**语义找**而不是按固定路径读：
 *   找 `music.play_url`（这一条作者已一手实测是人声轨）、找内容 id / 标题 / 时长，
 *   任一找不到就退回白名单里的值 —— **白名单才是权威标签**，解析只补参数。
 *
 * ⚠️ 服务端版本是 **v5（dtk 5.1.3）**，与初版写死的 v4 路径**不通用**：
 *   v5 一律要 `X-API-Key`，且**默认异步**（立刻回 202 + task_id）——
 *   我们加 `?wait=` 让它在连接上等，超时再去轮询任务。
 */

/** 解析服务基址 —— dtk 5.x 把 HTTP 与 MCP 都挂在 8000（见 .env.example） */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

/** 抖音 robots.txt —— 无论结论如何都要记一笔 checked_at */
const ROBOTS_URL = 'https://www.douyin.com/robots.txt';

/** 服务端 `?wait=` 的上限（实测 30）—— 超了是 400，不是「悄悄缩短」 */
const MAX_WAIT_SECONDS = 30;

/** `wait` 没等到结果时的轮询节奏 */
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 60;

/** v5 的统一信封 —— 成功失败都长这样 */
interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

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

/** v5 给的时长是**毫秒**且字段名带单位 —— 不猜单位 */
function asSecondsFromMs(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v / 1000);
}

/** 老路径的时长字段单位不定 —— 超过一小时的值按毫秒打折 */
function asSecondsLoose(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
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

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 连不上 / 不是 JSON —— 两件最容易混在一起的故障，分开说 */
async function getJson(
  url: string,
  apiKey: string | undefined,
  label: string,
): Promise<Envelope> {
  let res: Response;
  try {
    res = await fetch(url, { headers: apiKey ? { 'X-API-Key': apiKey } : {} });
  } catch (e) {
    // undici 把真因（ECONNREFUSED / ENOTFOUND / 超时）藏在 `error.cause` 里 ——
    // 不把它拿出来，日志里就只剩一句 `fetch failed`，够不着病因也看不见 URL。
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new Error(
      `${label}：连不上解析服务 GET ${url}\n` +
        `  真因：${cause?.code ?? cause?.message ?? (e as Error).message}\n` +
        `  服务起着吗？KB_PARSER_BASE_URL 对吗？`,
      { cause: e },
    );
  }
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!body) {
    throw new Error(`${label}：HTTP ${res.status}，返回的不是 JSON（${url}）—— 这个端口上是别的服务？`);
  }
  if (body.success === false) {
    const err = body.error;
    throw new Error(
      `${label}：服务端拒绝 —— ${err?.code ?? '（无错误码）'} ${err?.message ?? '（无消息）'}`,
    );
  }
  return body;
}

/** 任务没在 `wait` 内跑完 —— 拿 task_id 去把它取回来 */
async function pollTask(
  baseUrl: string,
  apiKey: string | undefined,
  taskId: unknown,
  label: string,
): Promise<Record<string, unknown>> {
  if (typeof taskId !== 'string' || !taskId) {
    throw new Error(`${label}：服务端回了「排队中」却没给 task_id —— 这次请求没法取回结果`);
  }
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const body = await getJson(`${baseUrl}/api/v1/tasks/${taskId}`, apiKey, label);
    const task = isObject(body.data) ? body.data : {};
    if (task.state === 'done') {
      if (!isObject(task.data)) throw new Error(`${label}：任务显示完成，但结果里没有 data`);
      return task.data;
    }
    if (task.state === 'failed') {
      const err = (isObject(task.error) ? task.error : body.error) as
        | { code?: string; message?: string }
        | undefined;
      throw new Error(
        `${label}：任务失败 —— ${err?.code ?? '（无错误码）'} ${err?.message ?? '（无消息）'}`,
      );
    }
  }
  throw new Error(
    `${label}：等了 ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000} 秒还没跑完（task ${taskId}）`,
  );
}

/**
 * 调一次解析服务，把「202 排队」这层抹平 —— 调用方只拿到 payload。
 *
 * ⚠️ 命中 `wait` 时服务端**直接把 payload 放在 `data`**（没有 state 那层）；
 *    没命中才回 `data = {task_id, state:'queued'}`。两种都要认。
 */
async function callParser(
  baseUrl: string,
  apiKey: string | undefined,
  path: string,
  params: Record<string, string>,
  label: string,
): Promise<Record<string, unknown>> {
  const url = `${baseUrl}${path}?${new URLSearchParams(params).toString()}`;
  const body = await getJson(url, apiKey, label);
  const data = isObject(body.data) ? body.data : null;
  if (!data) throw new Error(`${label}：响应里没有 data（${url}）`);

  if (data.state === 'queued' || data.state === 'running') {
    return pollTask(baseUrl, apiKey, data.task_id, label);
  }
  return data;
}

/** v5 的一条内容 → 我们要的字段（`data` 是**规范化负载**，不是平台原始响应） */
function parseItem(
  data: Record<string, unknown>,
  fallback: { creator: string; title: string; original_url: string; key: string },
): VideoCandidate {
  const videoId = findFirst(data, ['content_id', 'aweme_id', 'video_id', 'awemeId']);
  const kind = findFirst(data, ['kind']);
  return {
    platform_video_key: typeof videoId === 'string' ? videoId : fallback.key,
    video_id: typeof videoId === 'string' ? videoId : '',
    // 解析拿不到就用白名单的标签 —— 白名单是权威，解析只补参数
    creator: (findFirst(data, ['nickname']) as string) ?? fallback.creator,
    title: (findFirst(data, ['title', 'desc']) as string) ?? fallback.title,
    original_url: (findFirst(data, ['web_url']) as string) ?? fallback.original_url,
    duration_sec:
      asSecondsFromMs(findFirst(data, ['duration_ms'])) ??
      asSecondsLoose(findFirst(data, ['duration', 'video_duration'])),
    published_at: asIsoDate(findFirst(data, ['created_at', 'create_time', 'createTime'])),
    // 拿不到类型就当「不知道」—— 宁可漏一条，也不把图文的 BGM 当口播转写
    kind: typeof kind === 'string' ? kind : 'unknown',
    audio_url: findMusicPlayUrl(data),
  };
}

export interface DouyinFetcherOptions {
  baseUrl?: string;
  /** v5 全要的鉴权头 —— 只在作者本机，从 .env 来 */
  apiKey?: string;
  /** 音频落地的临时目录；缺省用系统临时目录 */
  tmpRoot?: string;
}

export function createDouyinFetcher(opts: DouyinFetcherOptions = {}): Fetcher {
  const baseUrl = (opts.baseUrl ?? process.env.KB_PARSER_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );
  const apiKey = opts.apiKey ?? process.env.KB_PARSER_API_KEY;
  const tmpRoot = opts.tmpRoot ?? tmpdir();
  const PLATFORM = 'douyin';

  /** 音频落地 —— 静态 CDN，免 cookie 免 referer（实测） */
  async function downloadAudio(audioUrl: string): Promise<string> {
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error(`音频下载失败：HTTP ${res.status}（${audioUrl.slice(0, 96)}…）`);
    const buf = Buffer.from(await res.arrayBuffer());

    const dir = await mkdtemp(join(tmpRoot, 'knowfit-audio-'));
    const ext = extname(new URL(audioUrl).pathname) || '.m4a';
    const audio_path = join(dir, `audio${ext}`);
    await writeFile(audio_path, buf);
    return audio_path;
  }

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
      const label = `解析视频 ${video.platform_video_key}`;
      const data = await callParser(
        baseUrl,
        apiKey,
        `/api/v1/${PLATFORM}/video`,
        { url: video.original_url, wait: String(MAX_WAIT_SECONDS) },
        label,
      );
      const item = parseItem(data, {
        creator: video.creator,
        title: video.title,
        original_url: video.original_url,
        key: video.platform_video_key,
      });
      if (!item.audio_url) {
        throw new Error(
          `${label}：解析结果里找不到 music.play_url —— 上游可能换层级了（先看 kb:ingest 打出来的键）`,
        );
      }
      return {
        platform_video_key: video.platform_video_key,
        video_id: item.video_id || video.platform_video_key,
        creator: item.creator,
        title: item.title,
        original_url: video.original_url,
        duration_sec: item.duration_sec,
        published_at: item.published_at,
        audio_path: await downloadAudio(item.audio_url),
      };
    },

    async listCreatorVideos(creator: Creator) {
      const label = `遍历博主 ${creator.creator}`;
      const data = await callParser(
        baseUrl,
        apiKey,
        `/api/v1/${PLATFORM}/user/posts`,
        { url: creator.profile_url, count: String(creator.max_items), wait: String(MAX_WAIT_SECONDS) },
        label,
      );
      const items = Array.isArray(data.items) ? data.items.filter(isObject) : [];
      const parsed = items.map((it) =>
        parseItem(it, {
          creator: creator.creator,
          title: '',
          original_url: creator.profile_url,
          key: '',
        }),
      );
      // 没有内容 id 的条目没法当键、也没法跟别处对上 —— 在解析这一层就丢掉
      return parsed.filter((c) => c.video_id !== '');
    },

    downloadAudio,

    async discardAudio(path: string) {
      const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
      if (dir) await rm(dir, { recursive: true, force: true });
    },
  };
}