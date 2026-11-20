import { describe, expect, it } from 'vitest';
import { StatsRangeSchema, WeeklyVolumePointSchema } from './metrics.js';

/** 契约测试：完整响应体必须能原样解析 —— 字段改名 / 漏字段会当场炸在这 */
const sample = {
  from: '2026-11-02',
  to: '2026-11-08',
  days: [{ date: '2026-11-03', total_volume_kg: 2400, working_sets: 4, hard_sets: 4 }],
  total_volume_kg: 2400,
  working_sets: 4,
  hard_sets: 4,
  by_muscle_sets: { chest: 4, delt_ant: 2, triceps: 2 },
  by_group_sets: { chest: 4, shoulders: 2, arms: 2 },
  muscle_groups: [
    {
      id: 'chest',
      name_zh: '胸',
      weekly_low: 10,
      weekly_high: 20,
      hard_sets: 4,
      muscles: [
        {
          id: 'chest',
          name_zh: '胸',
          hard_sets: 4,
          sources: [{ exercise_id: 'bench_press', name: '卧推', hard_sets: 4, weighted_sets: 4 }],
        },
      ],
    },
  ],
  unclassified: {
    hard_sets: 1,
    by_region: { region_back: 1 },
    region_labels: { region_back: '背' },
    unrecognized_hard_sets: 0,
    exercises: [{ name: '划船', hard_sets: 1, region_fallback: 'region_back' }],
  },
  previous: { from: '2026-10-26', to: '2026-11-01', hard_sets: 3, delta: 1, delta_pct: 33.33 },
  inferred_hard_sets: 0,
  warmup_sets: 2,
  training_days: 1,
  by_muscle: { chest: 2400, delt_ant: 1200, triceps: 1200 },
  weight_points: [{ date: '2026-11-03', weight_kg: 78.4 }],
  weight_latest: { date: '2026-11-03', weight_kg: 78.4 },
  weight_delta_kg: null,
};

describe('StatsRangeSchema', () => {
  it('完整响应解析通过', () => {
    const parsed = StatsRangeSchema.parse(sample);
    expect(parsed.hard_sets).toBe(4);
    expect(parsed.muscle_groups[0]?.muscles[0]?.sources[0]?.weighted_sets).toBe(4);
    expect(parsed.previous.delta_pct).toBe(33.33);
  });

  it('缺 hard_sets → 报错（旧响应不会被静默当成新口径）', () => {
    const rest: Record<string, unknown> = { ...sample };
    delete rest.hard_sets;
    expect(() => StatsRangeSchema.parse(rest)).toThrow();
  });

  it('delta_pct 可为 null（上期为 0）', () => {
    const out = StatsRangeSchema.parse({
      ...sample,
      previous: { from: '2026-10-26', to: '2026-11-01', hard_sets: 0, delta: 4, delta_pct: null },
    });
    expect(out.previous.delta_pct).toBeNull();
  });
});

describe('WeeklyVolumePointSchema', () => {
  it('带 hard_sets 的周点解析通过', () => {
    const p = WeeklyVolumePointSchema.parse({
      week_start: '2026-11-02',
      total_volume_kg: 1200,
      working_sets: 3,
      hard_sets: 3,
    });
    expect(p.hard_sets).toBe(3);
  });
});
