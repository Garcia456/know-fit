import type { WorkoutCardExercise, WorkoutCardSet } from '../api/types';

/** 动作展示名：优先中文名，没命中就原样显示用户说的 */
export function exerciseName(exercise: WorkoutCardExercise): string {
  return exercise.name_zh ?? exercise.raw_name;
}

export function isMissingValue(exercise: { sets: WorkoutCardSet[] }): boolean {
  const working = exercise.sets.filter((s) => s.set_type === 'working');
  return working.length === 0 || working.some((s) => s.weight_kg === null || s.reps === null);
}

/** 「4 组 · 70kg × 8」—— 组数按正式组算，缺值就说缺，不补 0 */
export function describeSets(exercise: { sets: WorkoutCardSet[] }): string {
  const working = exercise.sets.filter((s) => s.set_type === 'working');
  if (working.length === 0) return '组数待补';

  const weights = new Set(working.map((s) => s.weight_kg));
  const reps = new Set(working.map((s) => s.reps));

  if (weights.size === 1 && !weights.has(null) && reps.size === 1 && !reps.has(null)) {
    return `${working.length} 组 · ${[...weights][0]}kg × ${[...reps][0]}`;
  }

  const bits = [`${working.length} 组`];
  if (weights.has(null)) bits.push('重量待补');
  else if (weights.size > 1) bits.push('多重量');
  else bits.push(`${[...weights][0]}kg`);
  if (reps.has(null)) bits.push('次数待补');
  else if (reps.size > 1) bits.push('次数不一');
  return bits.join(' · ');
}