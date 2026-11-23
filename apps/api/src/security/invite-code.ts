import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * 知识库邀请码 —— 只用于设置页解锁 RAG，与注册无关。
 * 未配置 `KNOWLEDGE_INVITE_CODE` 视为功能未开放；配置后常量时间比较。
 */

export type InviteVerdict =
  | { ok: true }
  | { ok: false; code: 'not_configured' | 'wrong'; error: string };

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function checkInviteCode(
  given: string,
  env: NodeJS.ProcessEnv = process.env,
): InviteVerdict {
  const expected = env.KNOWLEDGE_INVITE_CODE?.trim();
  if (!expected) return { ok: false, code: 'not_configured', error: '知识库暂未开放' };

  const trimmed = given.trim();
  if (!trimmed) return { ok: false, code: 'wrong', error: '邀请码不对' };

  // 两边都先哈希成定长，再常量时间比较
  return timingSafeEqual(digest(expected), digest(trimmed))
    ? { ok: true }
    : { ok: false, code: 'wrong', error: '邀请码不对' };
}
