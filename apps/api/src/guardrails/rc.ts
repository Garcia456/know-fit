import { createHash } from 'node:crypto';

/**
 * R-C：运行期断言 —— 真的发出去的 JSON 里没有知识片全文。
 *
 * 做法：把全部 `knowledge_chunk.text` 切成 60 字窗口建哈希集合，
 * 递归扫响应里的每个字符串；命中即视为泄漏，整条响应换成 500。
 *
 * 🔴 白名单：`short_quote` 的值本来就是 chunk 子串，跳过不判。
 * 诚实边界：只扫经过钩子的 JSON；日志 / 非 JSON 不扫；刷新窗口内的新片可能漏扫；
 * 60 字窗口挡不住更短的片段（那属于引用，不是全文）。
 */

export const RC_WINDOW = 60;
const WHITELIST_KEY = 'short_quote';

export interface RcStats {
  scanned: number;
  blocked: number;
}

export interface RcVerdict {
  blocked: boolean;
  /** 命中的窗口哈希前缀 —— 只记这个，不记原文 */
  prefix: string | null;
}

export interface ResponseGuard {
  readonly windowCount: number;
  setTexts(texts: string[]): void;
  inspect(payload: unknown): RcVerdict;
}

function hashWindow(text: string, start: number): string {
  return createHash('sha256').update(text.slice(start, start + RC_WINDOW)).digest('hex').slice(0, 16);
}

function walk(value: unknown, visit: (s: string) => string | null): string | null {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walk(item, visit);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === WHITELIST_KEY) continue;
      const hit = walk(child, visit);
      if (hit) return hit;
    }
  }
  return null;
}

export function createResponseGuard(stats: RcStats): ResponseGuard {
  let windows = new Set<string>();

  return {
    get windowCount() {
      return windows.size;
    },

    setTexts(texts) {
      const next = new Set<string>();
      for (const text of texts) {
        for (let i = 0; i + RC_WINDOW <= text.length; i++) next.add(hashWindow(text, i));
      }
      windows = next;
    },

    inspect(payload) {
      stats.scanned++;
      const hit = walk(payload, (s) => {
        if (s.length < RC_WINDOW) return null;
        for (let i = 0; i + RC_WINDOW <= s.length; i++) {
          const hash = hashWindow(s, i);
          if (windows.has(hash)) return hash;
        }
        return null;
      });
      if (hit) {
        stats.blocked++;
        return { blocked: true, prefix: hit };
      }
      return { blocked: false, prefix: null };
    },
  };
}

/** 进程级单例 —— `/health` 读同一份计数，证明钩子真的跑了 */
export const rcStats: RcStats = { scanned: 0, blocked: 0 };
export const responseGuard = createResponseGuard(rcStats);
