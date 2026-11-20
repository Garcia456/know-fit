import { describe, expect, it } from 'vitest';
import { loadSeed } from '../seed/load.js';
import { MUSCLE_GROUPS, groupOfMuscle, proratedWeeklyRange } from './muscleGroups.js';

describe('展示组配置', () => {
  it('组 id 唯一', () => {
    const ids = MUSCLE_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('20 个细分肌群每个恰属一组 —— 无遗漏、无重复', () => {
    const members = MUSCLE_GROUPS.flatMap((g) => g.members);
    expect(new Set(members).size).toBe(members.length);
    const seedIds = loadSeed().muscle_regions.map((r) => r.id).sort();
    expect([...members].sort()).toEqual(seedIds);
    for (const id of seedIds) expect(groupOfMuscle(id), `muscle ${id} 不属于任何展示组`).toBeDefined();
  });

  it('参考区间 low < high', () => {
    for (const g of MUSCLE_GROUPS) {
      expect(g.weekly_low, g.id).toBeGreaterThan(0);
      expect(g.weekly_high, g.id).toBeGreaterThan(g.weekly_low);
    }
  });

  it('未知肌群 → undefined', () => {
    expect(groupOfMuscle('not_a_muscle')).toBeUndefined();
  });

  it('参考区间按区间天数折算，保留 1 位小数', () => {
    expect(proratedWeeklyRange({ weekly_low: 10, weekly_high: 20 }, 7)).toEqual({ low: 10, high: 20 });
    expect(proratedWeeklyRange({ weekly_low: 10, weekly_high: 20 }, 3)).toEqual({ low: 4.3, high: 8.6 });
    expect(proratedWeeklyRange({ weekly_low: 8, weekly_high: 16 }, 0)).toEqual({ low: 0, high: 0 });
  });
});
