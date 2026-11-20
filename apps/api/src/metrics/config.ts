import type { Exercise } from '../seed/load.js';

/**
 * 肌群分摊权重 —— 写成配置项，不写死常量。
 *
 * 角色只是数据里的声明；权重在这里定。
 * 消费方只拿 `muscleWeightsOf` 返回的数字，不自己判断角色 ——
 * 将来加 0.25 / 0.3 / 逐动作覆盖时，只改这个文件。
 */
export const MUSCLE_WEIGHTS = {
  primary: 1.0,
  secondary: 0.5,
  tertiary: 0.25,
  /** 说不清动作、只能定部位时，覆盖到的肌群全按 1.0（ADR-023） */
  fallback: 1.0,
} as const;

export interface MuscleWeight {
  muscle: string;
  weight: number;
}

/**
 * 动作 → [{ 肌群, 权重 }]。
 *
 * 顺序固定：主动肌 → 协同肌 → 第三档。
 * 同一肌群重复出现时不在这里去重（seed 校验负责拦住数据错误）。
 */
export function muscleWeightsOf(
  exercise: Pick<Exercise, 'primary_muscles' | 'secondary_muscles'> & {
    tertiary_muscles?: string[];
  },
): MuscleWeight[] {
  return [
    ...exercise.primary_muscles.map((muscle) => ({ muscle, weight: MUSCLE_WEIGHTS.primary })),
    ...exercise.secondary_muscles.map((muscle) => ({ muscle, weight: MUSCLE_WEIGHTS.secondary })),
    ...(exercise.tertiary_muscles ?? []).map((muscle) => ({
      muscle,
      weight: MUSCLE_WEIGHTS.tertiary,
    })),
  ];
}
