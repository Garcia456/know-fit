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
  hard_sets: z.number().int(),
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
  hard_sets: z.number().int(),
});

/** 单个动作在某个肌群上的有效组贡献 */
export const ExerciseHardSetSchema = z.object({
  exercise_id: z.string().nullable(),
  name: z.string(),
  hard_sets: z.number().int(),
  weighted_sets: z.number(),
});

export const UnclassifiedExerciseSchema = z.object({
  name: z.string(),
  hard_sets: z.number().int(),
  region_fallback: z.string().nullable(),
});

/** 细分肌群的有效组数 + 贡献动作 */
export const MuscleHardSetSchema = z.object({
  id: z.string(),
  name_zh: z.string(),
  hard_sets: z.number(),
  sources: z.array(ExerciseHardSetSchema),
});

/** 展示组：参考区间在这里下发，前端不再复制一份肌群配置 */
export const MuscleGroupHardSetSchema = z.object({
  id: z.string(),
  name_zh: z.string(),
  weekly_low: z.number(),
  weekly_high: z.number(),
  hard_sets: z.number(),
  muscles: z.array(MuscleHardSetSchema),
});

export const UnclassifiedHardSetsSchema = z.object({
  hard_sets: z.number().int(),
  by_region: z.record(z.string(), z.number().int()),
  region_labels: z.record(z.string(), z.string()),
  unrecognized_hard_sets: z.number().int(),
  exercises: z.array(UnclassifiedExerciseSchema),
});

export const PreviousStatsSchema = z.object({
  from: z.string(),
  to: z.string(),
  hard_sets: z.number().int(),
  delta: z.number().int(),
  delta_pct: z.number().nullable(),
});

export const StatsRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** 只含有训练的天，升序；不补零 */
  days: z.array(StatsDaySchema),
  total_volume_kg: z.number(),
  working_sets: z.number().int(),
  /** 正式组原始条数，每组只算一次 —— 主卡片数字 */
  hard_sets: z.number().int(),
  /** 主 1.0 / 次 0.5 / 第三档 0.25 加权后的 20 区组数 */
  by_muscle_sets: z.record(z.string(), z.number()),
  /** 9 个展示组的加权组数 */
  by_group_sets: z.record(z.string(), z.number()),
  /** 展示组明细（名称、参考区间、细分肌群、贡献动作） */
  muscle_groups: z.array(MuscleGroupHardSetSchema),
  unclassified: UnclassifiedHardSetsSchema,
  previous: PreviousStatsSchema,
  inferred_hard_sets: z.number().int(),
  warmup_sets: z.number().int(),
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
export type ExerciseHardSet = z.infer<typeof ExerciseHardSetSchema>;
export type UnclassifiedExercise = z.infer<typeof UnclassifiedExerciseSchema>;
export type MuscleHardSet = z.infer<typeof MuscleHardSetSchema>;
export type MuscleGroupHardSet = z.infer<typeof MuscleGroupHardSetSchema>;
export type UnclassifiedHardSets = z.infer<typeof UnclassifiedHardSetsSchema>;
export type PreviousStats = z.infer<typeof PreviousStatsSchema>;