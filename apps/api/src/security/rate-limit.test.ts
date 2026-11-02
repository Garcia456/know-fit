import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_DEFAULTS, buildRouteLimits, createRateLimiter } from './rate-limit.js';

describe('固定窗口限流', () => {
  it('上限内放行，超限拒绝并给 Retry-After', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    expect(limiter.take('ip-1').allowed).toBe(true);
    expect(limiter.take('ip-1').allowed).toBe(true);
    expect(limiter.take('ip-1').allowed).toBe(true);

    const denied = limiter.take('ip-1');
    expect(denied).toEqual({ allowed: false, retryAfterSec: 60 });

    now = 1_000;
    expect(limiter.take('ip-1')).toEqual({ allowed: false, retryAfterSec: 59 });
  });

  it('不同 key 各算一套', () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    expect(limiter.take('b').allowed).toBe(true);
  });

  it('窗口过去后重新计数', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });
    expect(limiter.take('k').allowed).toBe(true);
    expect(limiter.take('k').allowed).toBe(false);
    now = 1_000;
    expect(limiter.take('k').allowed).toBe(true);
  });
});

describe('路由限流配置', () => {
  it('默认值来自 ADR-060', () => {
    const limits = buildRouteLimits({});
    expect(limits.map((l) => [l.path, l.dimension])).toEqual([
      ['/auth/login', 'ip'],
      ['/auth/register', 'ip'],
      ['/turns', 'user'],
      ['/assessments', 'user'],
    ]);
    expect(limits[0]?.limiter.take('x').allowed).toBe(true);
  });

  it('环境变量可覆盖默认值', () => {
    const limits = buildRouteLimits({ RATE_LIMIT_LOGIN_PER_15MIN: '1' });
    const login = limits.find((l) => l.path === '/auth/login')!;
    expect(login.limiter.take('ip').allowed).toBe(true);
    expect(login.limiter.take('ip').allowed).toBe(false);
  });

  it('非法值退回默认，不把接口锁死', () => {
    const limits = buildRouteLimits({ RATE_LIMIT_LOGIN_PER_15MIN: 'abc' });
    const login = limits.find((l) => l.path === '/auth/login')!;
    for (let i = 0; i < RATE_LIMIT_DEFAULTS.loginPer15Min; i += 1) {
      expect(login.limiter.take('ip').allowed).toBe(true);
    }
    expect(login.limiter.take('ip').allowed).toBe(false);
  });
});