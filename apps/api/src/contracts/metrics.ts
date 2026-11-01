import { z } from 'zod';

/**
 * 对外契约：算出来的判定与训练量。
 * 判定只带数值与标签 —— 措辞归模板，不在这里出现句子。
 */

export const VolumeHookSchema = z.object({
  metric: z.literal('volume'),
  scope: z.object({ split_label: z.string().nullable() }),
  current: z.number(),
  baseline: z.number().nullable(),
  delta_pct: z.number().nullable(),
  baseline_kind: z.literal('prev_same_split'),
});

export const SessionVolumeSchema = z.object({
  session_id: z.string(),
  total_volume_kg: z.number(),
  working_sets: z.number().int(),
  warmup_sets: z.number().int(),
  skipped_sets: z.number().int(),
  inferred_sets: z.number().int(),
  by_muscle: z.record(z.string(), z.number()),
  unrecognized_exercises: z.number().int(),
});

/** 自然周容量（周一起算）—— 数据页近 N 周柱状图 */
export const WeeklyVolumePointSchema = z.object({
  week_start: z.string(), // 周一 'YYYY-MM-DD'
  total_volume_kg: z.number(),
  working_sets: z.number().int(),
});

export const WeeklyVolumeSchema = z.object({
  weeks: z.array(WeeklyVolumePointSchema),
  this_week_kg: z.number(),
  last_week_kg: z.number(),
  /** 上周为 0 时算不出环比 */
  delta_pct: z.number().nullable(),
});

export const WeightPointSchema = z.object({
  date: z.string(),
  weight_kg: z.number(),
});

export const WeightHistorySchema = z.object({
  points: z.array(WeightPointSchema), // 升序，只取有记录的日子，不插值
  latest: WeightPointSchema.nullable(),
  /** 窗口内首尾差值；少于两个点时为 null */
  delta_kg: z.number().nullable(),
});

/** 统计页：任意日期范围的聚合 */
export const StatsDaySchema = z.object({
  date: z.string(),
  total_volume_kg: z.number(),
  working_sets: z.number().int(),
});

export const StatsRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** 只含有训练的天，升序；不补零 */
  days: z.array(StatsDaySchema),
  total_volume_kg: z.number(),
  working_sets: z.number().int(),
  training_days: z.number().int(),
  by_muscle: z.record(z.string(), z.number()),
  weight_points: z.array(WeightPointSchema),
  weight_latest: WeightPointSchema.nullable(),
  weight_delta_kg: z.number().nullable(),
});

export type VolumeHook = z.infer<typeof VolumeHookSchema>;
export type SessionVolume = z.infer<typeof SessionVolumeSchema>;
export type WeeklyVolumePoint = z.infer<typeof WeeklyVolumePointSchema>;
export type WeeklyVolume = z.infer<typeof WeeklyVolumeSchema>;
export type WeightPoint = z.infer<typeof WeightPointSchema>;
export type WeightHistory = z.infer<typeof WeightHistorySchema>;
export type StatsDay = z.infer<typeof StatsDaySchema>;
export type StatsRange = z.infer<typeof StatsRangeSchema>;