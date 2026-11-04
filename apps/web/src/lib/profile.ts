import type { Goal, ProfileInput, TrainingFrequency } from '../api/types';

/** 档案表单的字符串 → 契约值。留空是合法值，不合法要当场说清楚。 */

export interface ProfileFormValues {
  height: string;
  weight: string;
  goal: Goal | null;
  frequency: TrainingFrequency | null;
  years: number | null;
  months: number | null;
}

/** 训练年限显示：未填 / 不足 1 个月 / X 年 Y 个月（为 0 的单位省略）。 */
export function formatTraining(years: number | null, months: number | null): string {
  if (years === null || months === null) return '未填';
  if (years === 0 && months === 0) return '不足 1 个月';
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} 年`);
  if (months > 0) parts.push(`${months} 个月`);
  return parts.join(' ');
}

/** 总月数；未填返回 null。 */
export function totalTrainingMonths(
  years: number | null,
  months: number | null,
): number | null {
  if (years === null || months === null) return null;
  return years * 12 + months;
}

export type ProfileParseResult =
  | { ok: true; input: ProfileInput }
  | { ok: false; errors: Partial<Record<'height' | 'weight', string>> };

function parseNumber(
  raw: string,
  range: [number, number],
  label: string,
): { value: number | null } | { error: string } {
  const text = raw.trim();
  if (text === '') return { value: null };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: `${label}请输入数字` };
  if (value < range[0] || value > range[1]) {
    return { error: `${label}需在 ${range[0]}–${range[1]} 之间` };
  }
  return { value };
}

export function parseProfileForm(values: ProfileFormValues): ProfileParseResult {
  const height = parseNumber(values.height, [100, 250], '身高');
  const weight = parseNumber(values.weight, [30, 300], '体重');
  const errors: Partial<Record<'height' | 'weight', string>> = {};
  if ('error' in height) errors.height = height.error;
  if ('error' in weight) errors.weight = weight.error;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      height_cm: 'value' in height ? height.value : null,
      weight_kg: 'value' in weight ? weight.value : null,
      goal: values.goal,
      training_frequency: values.frequency,
      training_years: values.years,
      training_months: values.months,
    },
  };
}

/** 读回来的档案 → 表单字符串（null 显示为空，不是 "0"） */
export function toFormValues(profile: {
  height_cm: number | null;
  weight_kg: number | null;
  goal: Goal | null;
  training_frequency: TrainingFrequency | null;
  training_years: number | null;
  training_months: number | null;
}): ProfileFormValues {
  return {
    height: profile.height_cm === null ? '' : String(profile.height_cm),
    weight: profile.weight_kg === null ? '' : String(profile.weight_kg),
    goal: profile.goal,
    frequency: profile.training_frequency,
    years: profile.training_years,
    months: profile.training_months,
  };
}