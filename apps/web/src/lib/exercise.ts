import type { WorkoutCardSet } from '../api/types';

/** 动作展示名：用户怎么说就怎么显示；归一后的中文名只用于肌群归类 */
export function exerciseName(exercise: { raw_name: string }): string {
  return exercise.raw_name;
}

export function isMissingValue(exercise: {
  is_bodyweight?: boolean;
  sets: WorkoutCardSet[];
}): boolean {
  const working = exercise.sets.filter((s) => s.set_type === 'working');
  return (
    working.length === 0 ||
    working.some((s) => s.reps === null || (!exercise.is_bodyweight && s.weight_kg === null))
  );
}

/** 「4 组 · 70kg × 8」—— 组数按正式组算，缺值就说缺，不补 0；自重动作不把空重量叫缺 */
export function describeSets(exercise: {
  is_bodyweight?: boolean;
  sets: WorkoutCardSet[];
}): string {
  const working = exercise.sets.filter((s) => s.set_type === 'working');
  if (working.length === 0) return '组数待补';

  const bodyweight = exercise.is_bodyweight === true;
  const weights = new Set(working.map((s) => s.weight_kg));
  const reps = new Set(working.map((s) => s.reps));
  const missingWeightLabel = bodyweight ? '自重' : '重量待补';

  let text: string;
  if (weights.size === 1 && !weights.has(null) && reps.size === 1 && !reps.has(null)) {
    text = `${working.length} 组 · ${[...weights][0]}kg × ${[...reps][0]}`;
  } else if (weights.size === 1 && weights.has(null) && reps.size === 1 && !reps.has(null)) {
    // 自重动作的常见形态：没说重量、次数一致
    text = `${working.length} 组 · ${missingWeightLabel} × ${[...reps][0]}`;
  } else {
    const bits = [`${working.length} 组`];
    if (weights.has(null)) bits.push(missingWeightLabel);
    else if (weights.size > 1) bits.push(bodyweight ? '多负重' : '多重量');
    else bits.push(`${[...weights][0]}kg`);
    if (reps.has(null)) bits.push('次数待补');
    else if (reps.size > 1) bits.push('次数不一');
    text = bits.join(' · ');
  }

  const failure = working.filter((s) => s.tags?.includes('failure')).length;
  const drops = working.filter((s) => s.tags?.includes('drop')).length;
  if (failure > 0) text += failure === working.length ? ' · 力竭' : ` · ${failure} 组力竭`;
  if (drops > 0) text += drops === working.length ? ' · 递减' : ` · ${drops} 组递减`;
  return text;
}