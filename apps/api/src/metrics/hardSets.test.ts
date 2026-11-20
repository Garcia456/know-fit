import { describe, expect, it } from 'vitest';
import type { Seed } from '../seed/load.js';
import { MUSCLE_GROUPS } from './muscleGroups.js';
import { countWorkingSets, summarizeHardSets, type HardSetExercise } from './hardSets.js';
import type { VolumeSet } from './volume.js';

/** 够用的假 seed —— 只关心计数与权重，不牵扯真数据 */
function fakeSeed(): Seed {
  return {
    $schema_version: 'test',
    $source: 'test',
    $generated: 'test',
    $counts: { muscle_regions: 4, exercises: 1, region_fallbacks: 1 },
    $notes: [],
    muscle_regions: [
      { id: 'chest', name_zh: '胸', name_en: 'chest', face: 'front', coarse: 'chest' },
      { id: 'delt_ant', name_zh: '前束', name_en: 'delt_ant', face: 'front', coarse: 'shoulders' },
      { id: 'triceps', name_zh: '三头', name_en: 'triceps', face: 'back', coarse: 'arms' },
      { id: 'lats', name_zh: '背阔', name_en: 'lats', face: 'back', coarse: 'back' },
    ],
    exercises: [
      {
        id: 'bench_press',
        name_zh: '杠铃卧推',
        aliases: [],
        equipment: ['杠铃'],
        mechanic: '推',
        primary_muscles: ['chest'],
        secondary_muscles: ['delt_ant', 'triceps'],
        tertiary_muscles: ['lats'],
        coarse: ['chest'],
      },
    ],
    region_fallbacks: [{ id: 'region_back', covers: ['lats'], triggers: ['划船'] }],
  };
}

const working = (n: number): VolumeSet[] =>
  Array.from({ length: n }, () => ({ weight_kg: 80, reps: 5, set_type: 'working' as const, is_inferred: false }));

const ex = (
  exercise_id: string | null,
  sets: VolumeSet[],
  extra: { region_fallback?: string | null; raw_name?: string } = {},
): HardSetExercise => ({
  exercise_id,
  region_fallback: extra.region_fallback ?? null,
  raw_name: extra.raw_name ?? '',
  sets,
});

describe('countWorkingSets：正式组条数', () => {
  it('每组只算一次；热身不计', () => {
    const sets: VolumeSet[] = [
      { weight_kg: 40, reps: 10, set_type: 'warmup', is_inferred: false },
      ...working(5),
    ];
    expect(countWorkingSets(sets)).toBe(5);
  });

  it('空数组 → 0', () => {
    expect(countWorkingSets([])).toBe(0);
  });
});

describe('summarizeHardSets：计数与摊分', () => {
  const seed = fakeSeed();

  it('缺重量 / 缺次数 / 自重 / 递减组 / 休息暂停都各算 1 组', () => {
    const sets: VolumeSet[] = [
      { weight_kg: null, reps: 5, set_type: 'working', is_inferred: false },
      { weight_kg: 80, reps: null, set_type: 'working', is_inferred: false },
      { weight_kg: null, reps: null, set_type: 'working', is_inferred: false, bodyweight_kg: 70 },
      { weight_kg: 60, reps: 8, set_type: 'working', is_inferred: false, drops: [{ weight_kg: 50, reps: 8 }] },
      { weight_kg: 60, reps: 8, set_type: 'working', is_inferred: false, tags: ['rest_pause'] },
    ];
    const out = summarizeHardSets([ex('bench_press', sets)], seed);
    expect(out.total).toBe(5);
    expect(out.warmup_sets).toBe(0);
  });

  it('热身组不计，单独回报', () => {
    const sets: VolumeSet[] = [
      { weight_kg: 40, reps: 10, set_type: 'warmup', is_inferred: false },
      { weight_kg: 40, reps: 10, set_type: 'warmup', is_inferred: false },
      ...working(3),
    ];
    const out = summarizeHardSets([ex('bench_press', sets)], seed);
    expect(out.total).toBe(3);
    expect(out.warmup_sets).toBe(2);
  });

  it('推测组照计，另记 inferred_hard_sets', () => {
    const sets: VolumeSet[] = [
      { weight_kg: null, reps: null, set_type: 'working', is_inferred: true },
      ...working(2),
    ];
    const out = summarizeHardSets([ex('bench_press', sets)], seed);
    expect(out.total).toBe(3);
    expect(out.inferred_hard_sets).toBe(1);
  });

  it('主 1.0 / 次 0.5 / 第三档 0.25 摊分；total 不按权重翻倍', () => {
    const out = summarizeHardSets([ex('bench_press', working(4))], seed);
    expect(out.total).toBe(4);
    expect(out.by_muscle.chest).toBe(4);
    expect(out.by_muscle.delt_ant).toBe(2);
    expect(out.by_muscle.triceps).toBe(2);
    expect(out.by_muscle.lats).toBe(1);
    expect(out.by_group.chest).toBe(4);
    expect(out.by_group.shoulders).toBe(2);
    expect(out.by_group.arms).toBe(2);
    expect(out.by_group.back).toBe(1);
  });

  it('贡献动作按动作聚合并带原始组数 / 加权组数', () => {
    const out = summarizeHardSets([ex('bench_press', working(4), { raw_name: '卧推' })], seed);
    expect(out.by_muscle_sources.chest).toEqual([
      { exercise_id: 'bench_press', name: '卧推', hard_sets: 4, weighted_sets: 4 },
    ]);
    expect(out.by_muscle_sources.delt_ant?.[0]).toMatchObject({ hard_sets: 4, weighted_sets: 2 });
  });

  it('定不到动作但能定部位 → 进 unclassified，不摊进 by_muscle', () => {
    const out = summarizeHardSets(
      [ex('bench_press', working(2)), ex(null, working(3), { region_fallback: 'region_back', raw_name: '划船' })],
      seed,
    );
    expect(out.by_muscle.lats).toBe(0.5);
    expect(out.unclassified.hard_sets).toBe(3);
    expect(out.unclassified.by_region).toEqual({ region_back: 3 });
    expect(out.unclassified.exercises).toEqual([
      { name: '划船', hard_sets: 3, region_fallback: 'region_back' },
    ]);
    expect(out.unclassified.unrecognized_hard_sets).toBe(0);
  });

  it('动作和部位都定不到 → unrecognized_hard_sets', () => {
    const out = summarizeHardSets([ex(null, working(2), { raw_name: '神秘器械' })], seed);
    expect(out.total).toBe(2);
    expect(out.unclassified.hard_sets).toBe(2);
    expect(out.unclassified.unrecognized_hard_sets).toBe(2);
    expect(out.unclassified.by_region).toEqual({});
    // 没名字时用占位名，不出现空串
    expect(out.unclassified.exercises[0]?.name).toBe('神秘器械');
  });

  it('不变量：total 拆得开、组键齐全、Σ by_group = Σ by_muscle', () => {
    const out = summarizeHardSets(
      [ex('bench_press', working(4)), ex(null, working(3), { region_fallback: 'region_back' }), ex(null, working(1))],
      seed,
    );
    const unclassified = out.unclassified.hard_sets;
    expect(out.total - unclassified).toBe(4);
    expect(out.unclassified.hard_sets).toBe(
      Object.values(out.unclassified.by_region).reduce((a, b) => a + b, 0) +
        out.unclassified.unrecognized_hard_sets,
    );
    expect(Object.keys(out.by_muscle).sort()).toEqual(seed.muscle_regions.map((r) => r.id).sort());
    expect(Object.keys(out.by_group).sort()).toEqual(MUSCLE_GROUPS.map((g) => g.id).sort());
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(out.by_group)).toBeCloseTo(sum(out.by_muscle), 10);
  });
});
