/**
 * 肌群分摊权重 —— 写成配置项，不写死常量。
 * 主动肌 1.0 / 协同肌 0.5；说不清动作、只能定部位时，覆盖到的肌群全按 1.0。
 */
export const MUSCLE_WEIGHTS = {
  primary: 1.0,
  secondary: 0.5,
  fallback: 1.0,
} as const;