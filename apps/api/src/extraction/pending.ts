import { resolveDate } from './dates.js';

/**
 * 待补记录的绑定 —— 纯函数，不读库、不调模型。
 *
 * 只在「用户这句没有时间状语 + 部位不冲突」时，把日期接回上一轮提到的待补槽；
 * 其余情况仍走 `resolveDate` 的默认兜底。
 */
export interface PendingContext {
  id: string;
  target_date: string;
  split_label: string | null;
}

export function bindPendingDate(input: {
  dayHint: string | null;
  extractedSplit: string | null;
  pending: PendingContext | null;
  now: Date;
}): { date: string; split_label: string | null; bound: boolean } {
  const fallback = resolveDate(input.dayHint, input.now);

  if (input.dayHint || !input.pending) {
    return { date: fallback, split_label: input.extractedSplit, bound: false };
  }

  const sameSplit =
    input.extractedSplit === null ||
    input.pending.split_label === null ||
    input.extractedSplit === input.pending.split_label;

  if (!sameSplit) {
    return { date: fallback, split_label: input.extractedSplit, bound: false };
  }

  return {
    date: input.pending.target_date,
    split_label: input.extractedSplit ?? input.pending.split_label,
    bound: true,
  };
}
