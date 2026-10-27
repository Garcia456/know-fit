import { describe, expect, it } from 'vitest';
import { daysBetween, gapsBetween, nudgeThresholdDays } from './nudges.js';

/** 断流阈值是纯算术 —— 不连库，也不让 LLM 参与。 */

describe('daysBetween', () => {
  it('跨月按真实天数算', () => {
    expect(daysBetween('2026-09-30', '2026-10-03')).toBe(3);
  });

  it('同一天是 0', () => {
    expect(daysBetween('2026-10-26', '2026-10-26')).toBe(0);
  });
});

describe('gapsBetween', () => {
  it('同一天多条记录只算一个点', () => {
    expect(gapsBetween(['2026-10-01', '2026-10-01', '2026-10-04'])).toEqual([3]);
  });

  it('乱序输入先排序', () => {
    expect(gapsBetween(['2026-10-08', '2026-10-01', '2026-10-04'])).toEqual([3, 4]);
  });
});

describe('nudgeThresholdDays', () => {
  it('数据不足（少于 2 个间隔）默认 7 天', () => {
    expect(nudgeThresholdDays([])).toBe(7);
    expect(nudgeThresholdDays([5])).toBe(7);
  });

  it('平均间隔 × 2', () => {
    expect(nudgeThresholdDays([4, 5])).toBe(9);
  });

  it('夹在 7–14 天', () => {
    expect(nudgeThresholdDays([2, 2])).toBe(7);
    expect(nudgeThresholdDays([10, 12])).toBe(14);
  });

  it('0 与非法值不计入平均', () => {
    expect(nudgeThresholdDays([0, 5, Number.NaN, 5])).toBe(10);
  });
});