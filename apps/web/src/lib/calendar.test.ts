import { describe, expect, it } from 'vitest';
import { addMonths, monthGrid, monthRange, parseDateKey, toDateKey } from './calendar';

describe('calendar', () => {
  it('本地时区拼日期，不跨天', () => {
    expect(toDateKey(new Date(2026, 9, 1))).toBe('2026-10-01');
    expect(toDateKey(new Date(2026, 9, 26))).toBe('2026-10-26');
  });

  it('整月区间含首尾', () => {
    expect(monthRange(new Date(2026, 9, 15))).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(monthRange(new Date(2026, 1, 1)).to).toBe('2026-02-28');
  });

  it('周一开头，长度是 7 的倍数', () => {
    const grid = monthGrid(new Date(2026, 9, 1));
    expect(grid.length % 7).toBe(0);
    // 2026-10-01 是周四 → 前面空 3 格（一 二 三）
    expect(grid.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it('翻月只动月份', () => {
    const next = addMonths(new Date(2026, 11, 15), 1);
    expect(toDateKey(next)).toBe('2027-01-01');
    expect(toDateKey(addMonths(new Date(2026, 0, 15), -1))).toBe('2025-12-01');
  });

  it('非法日期串返回 null', () => {
    expect(parseDateKey('2026-13-01')).toBeNull();
    expect(parseDateKey('x')).toBeNull();
  });
});