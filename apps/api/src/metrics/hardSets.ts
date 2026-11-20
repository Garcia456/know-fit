import type { Seed } from '../seed/load.js';
import { muscleWeightsOf } from './config.js';
import { MUSCLE_GROUPS, groupOfMuscle, type MuscleGroup } from './muscleGroups.js';
import type { VolumeSet } from './volume.js';

/**
 * 有效组数（Hard Sets）—— 与吨位完全分开的一套确定性计算。
 *
 * 口径（ADR-071）：
 *   - 所有 `working` 组各计 1 组，热身不计；
 *   - 缺重量 / 缺次数 / 自重 / 递减组 / 休息暂停都照计；
 *   - `total` 每组只算一次；`by_muscle` 才按主 / 次 / 第三档权重摊；
 *   - 定不到 exercise_id 的兜底动作不进 by_muscle，单列在 unclassified。
 */
export interface HardSetExercise {
  exercise_id: string | null;
  region_fallback: string | null;
  /** 展示用；ADR-051：优先用户原话 */
  raw_name: string;
  sets: VolumeSet[];
}

export interface ExerciseContribution {
  exercise_id: string | null;
  name: string;
  /** 原始正式组数 */
  hard_sets: number;
  /** 摊到该肌群后的组数 = hard_sets × weight */
  weighted_sets: number;
}

export interface UnclassifiedExercise {
  name: string;
  hard_sets: number;
  region_fallback: string | null;
}

export interface HardSetSummary {
  /** 所有 working 组，每组只算一次 */
  total: number;
  /** 20 区加权组数；未练到的为 0 */
  by_muscle: Record<string, number>;
  /** 9 个展示组加权组数 */
  by_group: Record<string, number>;
  /** 肌群 → 贡献动作（只含 > 0 的肌群） */
  by_muscle_sources: Record<string, ExerciseContribution[]>;
  /** 未能摊进肌群的部分 */
  unclassified: {
    hard_sets: number;
    by_region: Record<string, number>;
    unrecognized_hard_sets: number;
    exercises: UnclassifiedExercise[];
  };
  /** 其中系统推测的组数 —— 只回报，不影响计数 */
  inferred_hard_sets: number;
  warmup_sets: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 正式组条数 —— 一组多段（递减 / 休息暂停）仍算 1 组 */
export function countWorkingSets(sets: VolumeSet[]): number {
  let n = 0;
  for (const s of sets) {
    if (s.set_type === 'working') n += 1;
  }
  return n;
}

export function summarizeHardSets(
  exercises: HardSetExercise[],
  seed: Seed,
  groups: readonly MuscleGroup[] = MUSCLE_GROUPS,
): HardSetSummary {
  const byMuscleRaw: Record<string, number> = {};
  for (const region of seed.muscle_regions) byMuscleRaw[region.id] = 0;

  const musclesById = new Map(seed.exercises.map((e) => [e.id, e]));
  const sourcesByMuscle = new Map<string, Map<string, ExerciseContribution>>();
  const unclassifiedByRegion: Record<string, number> = {};
  const unclassifiedExercises = new Map<string, UnclassifiedExercise>();

  let total = 0;
  let inferred = 0;
  let warmup = 0;
  let unclassifiedSets = 0;
  let unrecognizedSets = 0;

  const addSource = (
    muscle: string,
    exerciseId: string | null,
    name: string,
    sets: number,
    weighted: number,
  ): void => {
    const key = exerciseId ?? name;
    const bucket = sourcesByMuscle.get(muscle) ?? new Map<string, ExerciseContribution>();
    const prev = bucket.get(key);
    bucket.set(key, {
      exercise_id: exerciseId,
      name: prev?.name ?? name,
      hard_sets: (prev?.hard_sets ?? 0) + sets,
      weighted_sets: round2((prev?.weighted_sets ?? 0) + weighted),
    });
    sourcesByMuscle.set(muscle, bucket);
  };

  const addUnclassified = (name: string, sets: number, region: string | null): void => {
    unclassifiedSets += sets;
    const key = `${region ?? 'none'}::${name}`;
    const prev = unclassifiedExercises.get(key);
    unclassifiedExercises.set(key, {
      name,
      hard_sets: (prev?.hard_sets ?? 0) + sets,
      region_fallback: region,
    });
  };

  for (const ex of exercises) {
    let working = 0;
    for (const s of ex.sets) {
      if (s.set_type !== 'working') {
        warmup += 1;
        continue;
      }
      working += 1;
      if (s.is_inferred) inferred += 1;
    }
    total += working;
    if (working === 0) continue;

    const known = ex.exercise_id ? musclesById.get(ex.exercise_id) : undefined;
    if (known) {
      const label = ex.raw_name.trim() || known.name_zh;
      for (const { muscle, weight } of muscleWeightsOf(known)) {
        byMuscleRaw[muscle] = (byMuscleRaw[muscle] ?? 0) + working * weight;
        addSource(muscle, known.id, label, working, working * weight);
      }
      continue;
    }

    const label = ex.raw_name.trim() || '未命名动作';
    const region = ex.region_fallback;
    if (region) {
      unclassifiedByRegion[region] = (unclassifiedByRegion[region] ?? 0) + working;
    } else {
      unrecognizedSets += working;
    }
    addUnclassified(label, working, region);
  }

  const byMuscle: Record<string, number> = {};
  for (const [muscle, value] of Object.entries(byMuscleRaw)) byMuscle[muscle] = round2(value);

  // 展示组由已取整的细分值求和，保证 Σ by_group = Σ by_muscle
  const byGroup: Record<string, number> = {};
  for (const group of groups) byGroup[group.id] = 0;
  for (const [muscle, value] of Object.entries(byMuscle)) {
    const group = groupOfMuscle(muscle);
    if (group) byGroup[group.id] = round2((byGroup[group.id] ?? 0) + value);
  }

  const byMuscleSources: Record<string, ExerciseContribution[]> = {};
  for (const [muscle, bucket] of sourcesByMuscle) {
    const list = [...bucket.values()]
      .map((c) => ({ ...c, weighted_sets: round2(c.weighted_sets) }))
      .sort((a, b) => b.weighted_sets - a.weighted_sets || a.name.localeCompare(b.name));
    if (list.length > 0) byMuscleSources[muscle] = list;
  }

  const unclassifiedList = [...unclassifiedExercises.values()].sort(
    (a, b) => b.hard_sets - a.hard_sets || a.name.localeCompare(b.name),
  );

  return {
    total,
    by_muscle: byMuscle,
    by_group: byGroup,
    by_muscle_sources: byMuscleSources,
    unclassified: {
      hard_sets: unclassifiedSets,
      by_region: unclassifiedByRegion,
      unrecognized_hard_sets: unrecognizedSets,
      exercises: unclassifiedList,
    },
    inferred_hard_sets: inferred,
    warmup_sets: warmup,
  };
}
