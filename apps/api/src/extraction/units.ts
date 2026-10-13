/** 磅 → 千克。1 lb 精确等于 0.45359237 kg。 */
const LB_TO_KG = 0.45359237;

export interface ConvertedWeight {
  weight_kg: number | null;
  /** 单位没提却说有重量 ⇒ 只能按 kg 记，标一下 */
  is_inferred: boolean;
}

/** 重量换算 —— 纯确定性，LLM 只报数字和单位 */
export function toKilograms(
  weight: number | null,
  unit: 'kg' | 'lb' | null,
  isInferred: boolean,
): ConvertedWeight {
  if (weight === null) return { weight_kg: null, is_inferred: isInferred };
  if (unit === 'lb') return { weight_kg: Math.round(weight * LB_TO_KG * 100) / 100, is_inferred: isInferred };
  return { weight_kg: weight, is_inferred: isInferred || unit === null };
}