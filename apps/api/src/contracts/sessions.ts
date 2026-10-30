import { z } from 'zod';
import { MissingFieldSchema, RecordStatusSchema, SetDropSchema, SetTagSchema } from './extraction.js';
import { SessionVolumeSchema, VolumeHookSchema } from './metrics.js';

/**
 * 数据页 / 档案页 / F7 的对外契约。
 * 🔴 字段名不得出现 text / content / transcript —— 读接口同样不携带原文全文。
 */

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期需为 YYYY-MM-DD');

export const SessionListQuerySchema = z.object({
  from: DateSchema,
  to: DateSchema,
});

export const SessionListItemSchema = z.object({
  session_id: z.string().uuid(),
  date: DateSchema,
  split_label: z.string().nullable(),
  status: RecordStatusSchema,
});

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionListItemSchema),
});

export const SessionSetSchema = z.object({
  weight_kg: z.number().nullable(),
  reps: z.number().int().nullable(),
  set_type: z.enum(['warmup', 'working']),
  is_inferred: z.boolean(),
  bodyweight_kg: z.number().nullable().optional(),
  tags: z.array(SetTagSchema).optional(),
  drops: z.array(SetDropSchema).nullable().optional(),
});

export const SessionExerciseSchema = z.object({
  raw_name: z.string(),
  exercise_id: z.string().nullable(),
  name_zh: z.string().nullable(),
  region_fallback: z.string().nullable(),
  name_confidence: z.enum(['high', 'low']).nullable(),
  is_bodyweight: z.boolean().optional(),
  sets: z.array(SessionSetSchema),
});

export const SessionDetailSchema = z.object({
  session_id: z.string().uuid(),
  date: DateSchema,
  split_label: z.string().nullable(),
  status: RecordStatusSchema,
  missing_fields: z.array(MissingFieldSchema),
  note: z.string().nullable(),
  exercises: z.array(SessionExerciseSchema),
  volume: SessionVolumeSchema,
  /** 数据页的环比卡片 —— 基线 = 同 split 上一次（dev-003） */
  hook: VolumeHookSchema,
});

/** PATCH 只追加：至少带一个动作；note 只用于「原本为空」的补写。 */
export const PatchSessionRequestSchema = z.object({
  exercises: z
    .array(
      z.object({
        raw_name: z.string().min(1),
        exercise_id: z.string().nullable().optional(),
        region_fallback: z.string().nullable().optional(),
        sets: z
          .array(
            z.object({
              weight_kg: z.number().nullable(),
              reps: z.number().int().nullable(),
              set_type: z.enum(['warmup', 'working']),
              is_inferred: z.boolean(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  note: z.string().min(1).nullable().optional(),
});

/** 手动编辑：按现有顺序覆盖动作名 / 重量 / 次数；不增删动作与组 */
export const UpdateSessionRequestSchema = z.object({
  exercises: z
    .array(
      z.object({
        raw_name: z.string().min(1),
        sets: z
          .array(
            z.object({
              weight_kg: z.number().min(0).max(2000).nullable(),
              reps: z.number().int().min(0).max(1000).nullable(),
              tags: z.array(SetTagSchema).optional(),
              drops: z.array(SetDropSchema).nullable().optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  note: z.string().max(500).nullable().optional(),
});

/** 记录级历史（对话抽屉）—— 没有会话实体，列的是可接回去的训练记录 */
export const HistoryItemSchema = z.object({
  session_id: z.string().uuid(),
  date: DateSchema,
  split_label: z.string().nullable(),
  status: RecordStatusSchema,
  missing_fields: z.array(MissingFieldSchema),
  exercise_count: z.number().int(),
  working_sets: z.number().int(),
  volume_kg: z.number(),
  exercise_names: z.array(z.string()),
});

export const HistoryResponseSchema = z.object({
  items: z.array(HistoryItemSchema),
});

export const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

const TrainingExperience = {
  /** 训练年限：整年 0–50；与 training_months 同为 null 表示未填 */
  training_years: z.number().int().min(0).max(50).nullable(),
  /** 训练年限的余月 0–11 */
  training_months: z.number().int().min(0).max(11).nullable(),
};

export const ProfileSchema = z
  .object({
    height_cm: z.number().min(100).max(250).nullable(),
    weight_kg: z.number().min(30).max(300).nullable(),
    /** 最新体重那一行的日期；没记过体重时为 null */
    weight_date: DateSchema.nullable(),
    goal: z.enum(['增肌', '减脂', '维持', '增肌+减脂']).nullable(),
    ...TrainingExperience,
    updated_at: z.string(),
  })
  .refine(
    (v) => (v.training_years === null) === (v.training_months === null),
    { message: '训练年限的年与月必须同时填写或同时留空', path: ['training_years'] },
  );

export const ProfileInputSchema = z
  .object({
    height_cm: z.number().min(100).max(250).nullable(),
    weight_kg: z.number().min(30).max(300).nullable(),
    goal: z.enum(['增肌', '减脂', '维持', '增肌+减脂']).nullable(),
    ...TrainingExperience,
  })
  .refine(
    (v) => (v.training_years === null) === (v.training_months === null),
    { message: '训练年限的年与月必须同时填写或同时留空', path: ['training_years'] },
  );

export const NudgeSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['补全', '断流']),
  session_id: z.string().uuid(),
  message: z.string(),
});

export const NudgeNextResponseSchema = z.object({
  nudge: NudgeSchema.nullable(),
});

export const NudgeActionSchema = z.object({
  action: z.enum(['补全', '忽略', '未响应']),
});

export type HistoryItem = z.infer<typeof HistoryItemSchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;
export type SessionExercise = z.infer<typeof SessionExerciseSchema>;
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
export type PatchSessionRequest = z.infer<typeof PatchSessionRequestSchema>;
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequestSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileInput = z.infer<typeof ProfileInputSchema>;
export type Nudge = z.infer<typeof NudgeSchema>;
export type NudgeNextResponse = z.infer<typeof NudgeNextResponseSchema>;
export type NudgeAction = z.infer<typeof NudgeActionSchema>;