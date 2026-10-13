import { z } from 'zod';
import {
  IntentSchema,
  MealItemSchema,
  MissingFieldSchema,
  RecordStatusSchema,
} from './extraction.js';

/**
 * 对外契约：一轮对话的回应（`POST /api/turns`）。
 *
 * 🔴 全部字段名已避开全文型字段名（text / content / transcript）—— 对外契约不许承载原文全文。
 */

/** 红线拒答的原因（preflight_guard 规则表的产出） */
export const RefusalReasonSchema = z.enum([
  'medical', // 伤病 / 疼痛
  'medication', // 用药 / 补剂剂量
  'extreme_diet', // 极端饮食
  'off_topic', // 与健身无关
]);

export const WorkoutCardSetSchema = z.object({
  weight_kg: z.number().nullable(),
  reps: z.number().int().nullable(),
  set_type: z.enum(['warmup', 'working']),
  is_inferred: z.boolean(),
});

export const WorkoutCardExerciseSchema = z.object({
  raw_name: z.string(),
  exercise_id: z.string().nullable(), // null = 不强行归并，不是错
  name_zh: z.string().nullable(), // 命中 seed 时的中文名
  region_fallback: z.string().nullable(), // 歧义动作的部位兜底
  name_confidence: z.enum(['high', 'low']),
  sets: z.array(WorkoutCardSetSchema),
});

export const WorkoutCardSchema = z.object({
  kind: z.literal('workout'),
  session_id: z.string(),
  date: z.string(), // 'YYYY-MM-DD'
  split_label: z.string().nullable(),
  status: RecordStatusSchema,
  missing_fields: z.array(MissingFieldSchema),
  exercises: z.array(WorkoutCardExerciseSchema),
  note: z.string().nullable(),
});

/** 饮食卡片 —— 只回抽取结果，不落库（MVP 只要契约） */
export const MealCardSchema = z.object({
  kind: z.literal('meal'),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).nullable(),
  items: z.array(MealItemSchema),
});

export const ChatCardSchema = z.object({
  kind: z.literal('chat'),
  reply: z.string(),
});

export const RefusalCardSchema = z.object({
  kind: z.literal('refusal'),
  reply: z.string(),
  reason: RefusalReasonSchema,
});

/** 非目标用户（未成年 / 有基础疾病 / 训练不足 3 个月）的出口 */
export const BoundaryCardSchema = z.object({
  kind: z.literal('boundary'),
  reply: z.string(),
});

export const TurnCardSchema = z.discriminatedUnion('kind', [
  WorkoutCardSchema,
  MealCardSchema,
  ChatCardSchema,
  RefusalCardSchema,
  BoundaryCardSchema,
]);

export const TurnResponseSchema = z.object({
  turn_id: z.string(),
  intent: IntentSchema,
  /** 没产生卡片的轮次（只求评估 / 红线条目）为 null */
  card: TurnCardSchema.nullable(),
  /** 补充提示，至多 1 条；后置、可选，不拦截录入 */
  notices: z.array(z.string()),
});

export const TurnRequestSchema = z.object({
  message: z.string().min(1),
});

export type RefusalReason = z.infer<typeof RefusalReasonSchema>;
export type WorkoutCardSet = z.infer<typeof WorkoutCardSetSchema>;
export type WorkoutCardExercise = z.infer<typeof WorkoutCardExerciseSchema>;
export type WorkoutCard = z.infer<typeof WorkoutCardSchema>;
export type MealCard = z.infer<typeof MealCardSchema>;
export type ChatCard = z.infer<typeof ChatCardSchema>;
export type RefusalCard = z.infer<typeof RefusalCardSchema>;
export type BoundaryCard = z.infer<typeof BoundaryCardSchema>;
export type TurnCard = z.infer<typeof TurnCardSchema>;
export type TurnResponse = z.infer<typeof TurnResponseSchema>;
export type TurnRequest = z.infer<typeof TurnRequestSchema>;