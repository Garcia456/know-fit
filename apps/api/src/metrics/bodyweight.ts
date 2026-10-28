import { loadSeed } from '../seed/load.js';

/** seed 里 equipment 含「自重」的动作 id —— 没写重量 ≠ 缺重量 */
let cached: Set<string> | null = null;

export function bodyweightExerciseIds(): Set<string> {
  cached ??= new Set(
    loadSeed()
      .exercises.filter((e) => e.equipment.includes('自重'))
      .map((e) => e.id),
  );
  return cached;
}

export function isBodyweightExercise(exerciseId: string | null): boolean {
  return exerciseId !== null && bodyweightExerciseIds().has(exerciseId);
}