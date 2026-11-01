import { describe, expect, it } from 'vitest';
import { resolveDate, tryResolveDate } from './dates.js';

const NOW = new Date(2026, 10, 1, 9, 0, 0); // 2026-11-01

describe('tryResolveDate：相对日期', () => {
  it('今天 / 昨天 / 前天', () => {
    expect(tryResolveDate('今天', NOW)).toBe('2026-11-01');
    expect(tryResolveDate('昨天', NOW)).toBe('2026-10-31');
    expect(tryResolveDate('前天', NOW)).toBe('2026-10-30');
  });

  it('认不出返回 null，不兜底', () => {
    expect(tryResolveDate('上周那次', NOW)).toBeNull();
    expect(tryResolveDate(null, NOW)).toBeNull();
  });
});

describe('tryResolveDate：绝对日期', () => {
  it('月日：10月31号 / 10月31日', () => {
    expect(tryResolveDate('10月31号', NOW)).toBe('2026-10-31');
    expect(tryResolveDate('10月31日', NOW)).toBe('2026-10-31');
    expect(tryResolveDate('2026年10月31号', NOW)).toBe('2026-10-31');
  });

  it('ISO 日期', () => {
    expect(tryResolveDate('2026-10-31', NOW)).toBe('2026-10-31');
  });

  it('只给日子：按 reference 的年月锚定', () => {
    expect(tryResolveDate('30号', NOW, '2026-10-31')).toBe('2026-10-30');
    expect(tryResolveDate('30号', NOW)).toBe('2026-11-30');
  });

  it('不存在的日期返回 null（不让 Date 进位到 3 月）', () => {
    expect(tryResolveDate('2月30号', NOW)).toBeNull();
    expect(tryResolveDate('2026-02-30', NOW)).toBeNull();
  });
});

describe('resolveDate：录入侧兜底', () => {
  it('认不出按今天算', () => {
    expect(resolveDate('上周那次', NOW)).toBe('2026-11-01');
  });

  it('认出就按认出的算', () => {
    expect(resolveDate('10月31号', NOW)).toBe('2026-10-31');
  });
});