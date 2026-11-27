import { z } from 'zod';

/** 数据页日历的日状态 —— 只下发已标记的日期；未知日期不出现。 */
export const DayStateItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  state: z.enum(['trained', 'rest', 'unlogged']),
  reason: z
    .enum(['planned_rest', 'deload', 'sick', 'travel', 'busy', 'other'])
    .nullable(),
});

export const DayStatesResponseSchema = z.object({
  days: z.array(DayStateItemSchema),
});

export type DayStateItem = z.infer<typeof DayStateItemSchema>;
export type DayStatesResponse = z.infer<typeof DayStatesResponseSchema>;
