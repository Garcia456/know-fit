import type { TrainingFrequency } from '../contracts/sessions.js';

/** 计划请求的确定性规则 —— 不读库、不调模型，图与服务共用。 */

export const TRAINING_FREQUENCIES: TrainingFrequency[] = [
  '二分化',
  '三分化',
  '四分化',
  '五分化',
  '不规律',
];

const FREQUENCY_DAYS: Record<string, number> = {
  二分化: 2,
  三分化: 3,
  四分化: 4,
  五分化: 5,
};

const CN_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
};

/** 句子里明确提到的训练频率；没有就 null。 */
export function frequencyIn(text: string): TrainingFrequency | null {
  return TRAINING_FREQUENCIES.find((f) => text.includes(f)) ?? null;
}

/** 分化对应的训练日数量；不规律由用户单独给天数。 */
export function splitDayCount(frequency: TrainingFrequency): number | null {
  return FREQUENCY_DAYS[frequency] ?? null;
}

/** 「每周 3 天」「一周四练」「能练 4 天」里的天数；没有就 null。 */
export function weeklyDaysIn(text: string): number | null {
  const match =
    text.match(/(?:每周|一周|一个星期|1\s*周)\s*(?:能练|练)?\s*([1-7一二两三四五六七])\s*(?:天|练|次)/) ??
    text.match(/([1-7一二两三四五六七])\s*天/);
  if (!match) return null;
  const raw = match[1]!;
  return CN_NUMBERS[raw] ?? Number(raw);
}

/** 上一轮助手在问频率 / 天数，这一轮正好是答案 —— 确定性接回计划，不重新分类。 */
export function planFollowup(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): 'frequency' | 'days' | null {
  const previous = [...history].reverse().find((h) => h.role === 'assistant')?.content ?? '';
  if (previous.includes('训练频率') && frequencyIn(message)) return 'frequency';
  if (previous.includes('每周能练几天') && weeklyDaysIn(message) !== null) return 'days';
  return null;
}

export interface CycleSlot {
  day: number;
  /** 对应第几个训练日模板；休息日为 null */
  trainIndex: number | null;
}

/** 一个循环里的训练日；休息不占行，由 cycle 文案说明。 */
export function cycleSlots(splitCount: number): CycleSlot[] {
  const n = Math.max(1, Math.min(7, splitCount));
  return Array.from({ length: n }, (_, i) => ({ day: i + 1, trainIndex: i }));
}