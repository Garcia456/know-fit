import { describe, expect, it } from 'vitest';
import { buildVolumeHook } from './hook.js';

describe('容量环比判定', () => {
  it('有基线 → 算出整数百分比', () => {
    const h = buildVolumeHook({ current: 2000, baseline: 2500, split_label: '推日' });
    expect(h).toMatchObject({
      metric: 'volume',
      scope: { split_label: '推日' },
      current: 2000,
      baseline: 2500,
      delta_pct: -20,
      baseline_kind: 'prev_same_split',
    });
  });

  it('没有基线 → 仍出钩子，只是不带数字', () => {
    const h = buildVolumeHook({ current: 2500, baseline: null, split_label: null });
    expect(h.baseline).toBeNull();
    expect(h.delta_pct).toBeNull();
    expect(h.current).toBe(2500);
  });

  it('基线为 0 → 不算百分比（不能除以 0）', () => {
    expect(buildVolumeHook({ current: 100, baseline: 0, split_label: '腿日' }).delta_pct).toBeNull();
  });

  it('判定只有固定的几个键 —— 没有句子字段', () => {
    const h = buildVolumeHook({ current: 2500, baseline: 2000, split_label: '背日' });
    expect(Object.keys(h).sort()).toEqual([
      'baseline',
      'baseline_kind',
      'current',
      'delta_pct',
      'metric',
      'scope',
    ]);
  });
});