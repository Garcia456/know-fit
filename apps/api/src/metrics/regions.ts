import { MUSCLE_WEIGHTS } from './config.js';
import { computeVolume, type VolumeSet } from './volume.js';
import type { Seed } from '../seed/load.js';

export interface AllocExercise {
  /** 规范化动作 id；null = 没归并成功 */
  exercise_id: string | null;
  /** 部位兜底，如 'region_back'；只在 exercise_id 为 null 时用 */
  region_fallback: string | null;
  sets: VolumeSet[];
}

export interface MuscleVolume {
  /** 肌群 id → 训练量（kg）。seed 里每一块肌群都在，没练到的为 0 */
  by_muscle: Record<string, number>;
  /** 贡献不了任何肌群的动作数（说不清动作、也定不到部位） */
  unrecognized_exercises: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 把每个动作的容量摊到肌群上。
 * 主动肌 1.0、协同肌 0.5；只有部位能定时，覆盖到的肌群全按 1.0。
 * 两者都不定的动作计进 unrecognized，不静默丢弃。
 */
export function allocateMuscleVolume(exercises: AllocExercise[], seed: Seed): MuscleVolume {
  const byMuscle: Record<string, number> = {};
  for (const region of seed.muscle_regions) byMuscle[region.id] = 0;

  const musclesById = new Map(seed.exercises.map((e) => [e.id, e]));
  const coversById = new Map(seed.region_fallbacks.map((f) => [f.id, f.covers]));

  let unrecognized = 0;

  for (const ex of exercises) {
    const volume = computeVolume(ex.sets).total_kg;

    const known = ex.exercise_id ? musclesById.get(ex.exercise_id) : undefined;
    if (known) {
      for (const m of known.primary_muscles) byMuscle[m] = (byMuscle[m] ?? 0) + volume * MUSCLE_WEIGHTS.primary;
      for (const m of known.secondary_muscles) byMuscle[m] = (byMuscle[m] ?? 0) + volume * MUSCLE_WEIGHTS.secondary;
      continue;
    }

    const covers = ex.region_fallback ? coversById.get(ex.region_fallback) : undefined;
    if (covers) {
      for (const m of covers) byMuscle[m] = (byMuscle[m] ?? 0) + volume * MUSCLE_WEIGHTS.fallback;
      continue;
    }

    unrecognized += 1;
  }

  for (const m of Object.keys(byMuscle)) byMuscle[m] = round2(byMuscle[m] ?? 0);
  return { by_muscle: byMuscle, unrecognized_exercises: unrecognized };
}