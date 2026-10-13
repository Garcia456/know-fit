import { describe, expect, it } from 'vitest';
import type { Seed } from '../seed/load.js';
import { allocateMuscleVolume, type AllocExercise } from './regions.js';

/** 造一个够用的假 seed —— 只要肌群、动作、兜底三张表，验分摊时不必牵扯真数据 */
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
      { id: 'lats', name_zh: '背阔', name_en: 'lats', face: 'back', coarse: 'back' },
      { id: 'biceps', name_zh: '肱二头', name_en: 'biceps', face: 'back', coarse: 'arms' },
    ],
    exercises: [
      {
        id: 'bench_press',
        name_zh: '杠铃卧推',
        aliases: [],
        equipment: ['杠铃'],
        mechanic: '推',
        primary_muscles: ['chest'],
        secondary_muscles: ['delt_ant'],
        coarse: ['chest'],
      },
    ],
    region_fallbacks: [{ id: 'region_back', covers: ['lats', 'biceps'], triggers: ['划船'] }],
  };
}

const sets = (weight: number, reps: number) =>
  [{ weight_kg: weight, reps, set_type: 'working' as const, is_inferred: false }];

describe('肌群分摊：主动肌 1.0 + 协同肌 0.5', () => {
  const seed = fakeSeed();

  it('能定到动作 → 主动肌 1.0、协同肌 0.5', () => {
    const ex: AllocExercise = { exercise_id: 'bench_press', region_fallback: null, sets: sets(100, 5) };
    const r = allocateMuscleVolume([ex], seed);
    expect(r.by_muscle.chest).toBe(500);
    expect(r.by_muscle.delt_ant).toBe(250);
  });

  it('热身组不进分摊', () => {
    const ex: AllocExercise = {
      exercise_id: 'bench_press',
      region_fallback: null,
      sets: [
        { weight_kg: 40, reps: 10, set_type: 'warmup', is_inferred: false },
        ...sets(100, 5),
      ],
    };
    expect(allocateMuscleVolume([ex], seed).by_muscle.chest).toBe(500);
  });

  it('定不到动作但能定部位 → 覆盖的肌群全按 1.0', () => {
    const ex: AllocExercise = { exercise_id: null, region_fallback: 'region_back', sets: sets(50, 10) };
    const r = allocateMuscleVolume([ex], seed);
    expect(r.by_muscle.lats).toBe(500);
    expect(r.by_muscle.biceps).toBe(500);
    expect(r.unrecognized_exercises).toBe(0);
  });

  it('两者都定不到 → 计进未识别，不静默丢弃', () => {
    const ex: AllocExercise = { exercise_id: null, region_fallback: null, sets: sets(50, 10) };
    const r = allocateMuscleVolume([ex], seed);
    expect(r.unrecognized_exercises).toBe(1);
    expect(r.by_muscle.chest).toBe(0);
  });

  it('没练到的肌群也在结果里，值为 0', () => {
    const ex: AllocExercise = { exercise_id: 'bench_press', region_fallback: null, sets: sets(100, 5) };
    const r = allocateMuscleVolume([ex], seed);
    expect(Object.keys(r.by_muscle).sort()).toEqual(['biceps', 'chest', 'delt_ant', 'lats']);
    expect(r.by_muscle.lats).toBe(0);
  });
});