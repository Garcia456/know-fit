import type { MissingField, RecordStatus, Workout } from '../contracts/extraction.js';

/**
 * 记录完整度 —— 缺什么由代码算，不由 LLM 输出（喂 F7 与北极星，必须可审计）。
 */

export interface RecordCompleteness {
  status: RecordStatus;
  missing_fields: MissingField[];
}

/**
 * 只把「影响这条记录能不能用」的字段算作缺失。
 * ⚠️ split_label 不算 —— 几乎每条记录都没说练什么日，算进去会让 status 恒为 incomplete。
 */
export function computeStatus(session: Workout): RecordCompleteness {
  const missing: MissingField[] = [];
  const sets = session.exercises.flatMap((e) => e.mentioned_sets);

  if (session.exercises.length === 0) missing.push('exercises');
  if (sets.some((s) => s.reps === null)) missing.push('reps');
  if (sets.some((s) => s.weight_kg === null)) missing.push('weight_kg');

  return {
    status: missing.length ? 'incomplete' : 'complete',
    missing_fields: missing,
  };
}