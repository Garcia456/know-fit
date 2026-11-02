import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * 注册闸门：设置 REGISTRATION_INVITE_CODE 时必须带对的邀请码。
 * 生产未设置视为关闭注册；本地未设置保持开放（e2e 要能注册）。
 */

export type RegistrationVerdict = { ok: true } | { ok: false; error: string };

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function checkRegistration(
  inviteCode: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): RegistrationVerdict {
  const expected = env.REGISTRATION_INVITE_CODE?.trim();
  if (!expected) {
    if (env.NODE_ENV === 'production') {
      return { ok: false, error: '注册未开放' };
    }
    return { ok: true };
  }

  const given = inviteCode?.trim();
  if (!given) return { ok: false, error: '需要邀请码' };

  // 两边都先哈希成定长，再常量时间比较
  return timingSafeEqual(digest(expected), digest(given))
    ? { ok: true }
    : { ok: false, error: '邀请码不对' };
}