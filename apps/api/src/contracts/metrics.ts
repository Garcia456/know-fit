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

export type VolumeHook = z.infer<typeof VolumeHookSchema>;
export type SessionVolume = z.infer<typeof SessionVolumeSchema>;