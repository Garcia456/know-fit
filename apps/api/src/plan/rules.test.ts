import { describe, expect, it } from 'vitest';
import { cycleSlots, frequencyIn, planFollowup, splitDayCount, weeklyDaysIn } from './rules.js';

describe('frequencyIn：句子里认频率', () => {
  it('直接说分化名就认', () => {
    expect(frequencyIn('帮我出个三分化训练计划')).toBe('三分化');
    expect(frequencyIn('就按五分化排')).toBe('五分化');
    expect(frequencyIn('我练得不规律')).toBe('不规律');
  });

  it('没说就是 null', () => {
    expect(frequencyIn('帮我出个训练计划')).toBeNull();
  });
});

describe('splitDayCount：分化对应训练日', () => {
  it('N 分化 = N 个训练日', () => {
    expect(splitDayCount('二分化')).toBe(2);
    expect(splitDayCount('三分化')).toBe(3);
    expect(splitDayCount('四分化')).toBe(4);
    expect(splitDayCount('五分化')).toBe(5);
  });

  it('不规律没有固定日数', () => {
    expect(splitDayCount('不规律')).toBeNull();
  });
});

describe('weeklyDaysIn：不规律时问到的天数', () => {
  it('几种常见说法都能读', () => {
    expect(weeklyDaysIn('每周 3 天')).toBe(3);
    expect(weeklyDaysIn('一周四练')).toBe(4);
    expect(weeklyDaysIn('我一周能练2次')).toBe(2);
    expect(weeklyDaysIn('能练四天')).toBe(4);
  });

  it('不回天数就是 null', () => {
    expect(weeklyDaysIn('不规律，看情况')).toBeNull();
  });
});

describe('planFollowup：上一轮在问就接回计划', () => {
  it('上一轮问频率，这一轮报频率', () => {
    const history = [{ role: 'assistant' as const, content: '你现在的训练频率是？二分化 / 三分化' }];
    expect(planFollowup('三分化', history)).toBe('frequency');
  });

  it('上一轮问天数，这一轮报天数', () => {
    const history = [{ role: 'assistant' as const, content: '每周能练几天？比如「每周 3 天」。' }];
    expect(planFollowup('每周 3 天', history)).toBe('days');
  });

  it('接不上就不抢路由', () => {
    const history = [{ role: 'assistant' as const, content: '你好，想记什么？' }];
    expect(planFollowup('三分化', history)).toBeNull();
    expect(planFollowup('三分化', [])).toBeNull();
  });
});

describe('cycleSlots：一个循环里只有训练日', () => {
  it('三分化 → 第 1、2、3 天，各配一个模板', () => {
    expect(cycleSlots(3)).toEqual([
      { day: 1, trainIndex: 0 },
      { day: 2, trainIndex: 1 },
      { day: 3, trainIndex: 2 },
    ]);
  });

  it('二分化 / 五分化按天数展开，不重复到 7 天', () => {
    expect(cycleSlots(2).map((s) => s.day)).toEqual([1, 2]);
    expect(cycleSlots(5).map((s) => s.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it('上限夹到 7；下限 1', () => {
    expect(cycleSlots(9)).toHaveLength(7);
    expect(cycleSlots(0)).toHaveLength(1);
  });
});