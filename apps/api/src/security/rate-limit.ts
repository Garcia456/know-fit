/**
 * 进程内固定窗口限流。
 * 单实例受控演示够用；重启归零，多实例各算一套（ADR-060）。
 */

export interface RateLimiter {
  /** 记一次；超限返回建议的 Retry-After 秒数。 */
  take(key: string): { allowed: true } | { allowed: false; retryAfterSec: number };
  reset(): void;
}

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  // 防止被大量随机 key（伪造 IP / 请求头）撑爆内存
  const MAX_BUCKETS = 10_000;
  let calls = 0;

  function prune(ts: number): void {
    for (const [key, bucket] of buckets) {
      if (ts >= bucket.resetAt) buckets.delete(key);
    }
  }

  return {
    take(key) {
      const ts = now();
      calls += 1;
      if (calls % 512 === 0 || buckets.size >= MAX_BUCKETS) prune(ts);

      let bucket = buckets.get(key);
      if (!bucket || ts >= bucket.resetAt) {
        bucket = { count: 0, resetAt: ts + windowMs };
        buckets.set(key, bucket);
      }

      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - ts) / 1000)),
        };
      }
      bucket.count += 1;
      return { allowed: true };
    },
    reset() {
      buckets.clear();
    },
  };
}

/** 环境变量里写了非法值时退回默认，不让配置笔误把接口整个关掉。 */
function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export interface RouteLimit {
  method: 'POST';
  path: string;
  dimension: 'ip' | 'user';
  message: string;
  limiter: RateLimiter;
}

export const RATE_LIMIT_DEFAULTS = {
  loginPer15Min: 20,
  registerPerHour: 5,
  turnPerHour: 120,
  assessmentPerHour: 60,
} as const;

export function buildRouteLimits(
  env: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now,
): RouteLimit[] {
  const minute = 60_000;
  const hour = 60 * minute;

  return [
    {
      method: 'POST',
      path: '/auth/login',
      dimension: 'ip',
      message: '登录尝试过于频繁，请稍后再试',
      limiter: createRateLimiter({
        limit: positiveInt(env.RATE_LIMIT_LOGIN_PER_15MIN, RATE_LIMIT_DEFAULTS.loginPer15Min),
        windowMs: 15 * minute,
        now,
      }),
    },
    {
      method: 'POST',
      path: '/auth/register',
      dimension: 'ip',
      message: '注册过于频繁，请稍后再试',
      limiter: createRateLimiter({
        limit: positiveInt(
          env.RATE_LIMIT_REGISTER_PER_HOUR,
          RATE_LIMIT_DEFAULTS.registerPerHour,
        ),
        windowMs: hour,
        now,
      }),
    },
    {
      method: 'POST',
      path: '/turns',
      dimension: 'user',
      message: '对话太频繁了，请稍后再试',
      limiter: createRateLimiter({
        limit: positiveInt(env.TURN_QUOTA_PER_HOUR, RATE_LIMIT_DEFAULTS.turnPerHour),
        windowMs: hour,
        now,
      }),
    },
    {
      method: 'POST',
      path: '/assessments',
      dimension: 'user',
      message: '评估请求太频繁了，请稍后再试',
      limiter: createRateLimiter({
        limit: positiveInt(
          env.ASSESSMENT_QUOTA_PER_HOUR,
          RATE_LIMIT_DEFAULTS.assessmentPerHour,
        ),
        windowMs: hour,
        now,
      }),
    },
  ];
}