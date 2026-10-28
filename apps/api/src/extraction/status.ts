import type { MissingField, RecordStatus } from '../contracts/extraction.js';

/**
 * 记录完整度 —— 缺什么由代码算，不由 LLM 输出（喂 F7 与北极星，必须可审计）。
 */

export interface StatusSet {
  weight_kg: number | null;
  reps: number | null;
  tags?: ('failure' | 'drop')[];
  drops?: { weight_kg: number | null; reps: number | null }[] | null;
}

export interface StatusExercise {
  /** seed equipment 含「自重」的动作，重量天然可以为空 */
  is_bodyweight: boolean;
  sets: StatusSet[];
}

export interface RecordCompleteness {
  status: RecordStatus;
  missing_fields: MissingField[];
}

/**
 * 只把「影响这条记录能不能用」的字段算作缺失。
 * ⚠️ split_label 不算 —— 几乎每条记录都没说练什么日，算进去会让 status 恒为 incomplete。
 * ⚠️ 自重动作没写重量 = 自重，不算缺；递减组只要任一段重量次数齐就算有。
 */
export function computeStatus(exercises: StatusExercise[]): RecordCompleteness {
  const missing: MissingField[] = [];

  if (exercises.length === 0) missing.push('exercises');

  const sets = exercises.flatMap((e) => e.sets.map((s) => ({ ...s, is_bodyweight: e.is_bodyweight })));
  if (sets.some((s) => s.reps === null)) missing.push('reps');

  const weightMissing = sets.some((s) => {
    if (s.is_bodyweight) return false;
    if (s.tags?.includes('drop') && s.drops && s.drops.length > 0) {
      return s.drops.every((d) => d.weight_kg === null);
    }
    return s.weight_kg === null;
  });
  if (weightMissing) missing.push('weight_kg');

  return {
    status: missing.length ? 'incomplete' : 'complete',
    missing_fields: missing,
  };
}