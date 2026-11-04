import { z } from 'zod';
import { AssessmentCardSchema, CitationSchema } from './assessment.js';
import {
  IntentSchema,
  MealItemSchema,
  MissingFieldSchema,
  RecordStatusSchema,
  SetDropSchema,
  SetTagSchema,
} from './extraction.js';
import { VolumeHookSchema } from './metrics.js';

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
  weight_kg: z.number().nullable(), // 自重动作里是「额外负重」
  reps: z.number().int().nullable(),
  set_type: z.enum(['warmup', 'working']),
  is_inferred: z.boolean(),
  /** 自重动作算容量时叠加的体重；旧卡 / 旧记录可能没有 */
  bodyweight_kg: z.number().nullable().optional(),
  tags: z.array(SetTagSchema).optional(),
  drops: z.array(SetDropSchema).nullable().optional(),
});

export const WorkoutCardExerciseSchema = z.object({
  raw_name: z.string(),
  exercise_id: z.string().nullable(), // null = 不强行归并，不是错
  name_zh: z.string().nullable(), // 命中 seed 时的中文名
  region_fallback: z.string().nullable(), // 歧义动作的部位兜底
  name_confidence: z.enum(['high', 'low']),
  /** seed equipment 含「自重」—— 没说重量不等于缺数据 */
  is_bodyweight: z.boolean().optional(),
  sets: z.array(WorkoutCardSetSchema),
  /** 该动作容量（正式组 Σ 重量 × 次数）—— 代码算，展示层不重算 */
  volume_kg: z.number(),
  working_sets: z.number().int(),
});

export const WorkoutCardSchema = z.object({
  kind: z.literal('workout'),
  session_id: z.string(),
  date: z.string(), // 'YYYY-MM-DD'
  split_label: z.string().nullable(),
  status: RecordStatusSchema,
  missing_fields: z.array(MissingFieldSchema),
  exercises: z.array(WorkoutCardExerciseSchema),
  volume_kg: z.number(),
  working_sets: z.number().int(),
  note: z.string().nullable(),
  /** 数据钩子 —— 记录完成后带的判定（已算好的数）。算不出基线时也出现，只是不带数字 */
  hook: VolumeHookSchema.nullable(),
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

/** 知识问答的一条主张 —— citation_id 只指向本卡 citations 里的编号 */
export const KnowledgeClaimSchema = z.object({
  claim: z.string(),
  citation_id: z.string().nullable(),
});

/** 知识回答 —— 个人判定不是它的前提，故不复用评估卡 */
export const KnowledgeCardSchema = z.object({
  kind: z.literal('knowledge'),
  answer: z.string(),
  claims: z.array(KnowledgeClaimSchema),
  citations: z.array(CitationSchema),
  has_source: z.boolean(),
  no_source_notice: z.string().nullable(),
});

/** 计划里的一个动作 —— 组次是 AI 给的，来源引用另挂 */
export const PlanExerciseSchema = z.object({
  name: z.string(),
  sets: z.number().int().positive().nullable(),
  reps: z.string(),
  note: z.string().nullable(),
});

export const PlanDaySchema = z.object({
  day: z.number().int().min(1).max(7),
  kind: z.enum(['train', 'rest']),
  focus: z.string().nullable(),
  exercises: z.array(PlanExerciseSchema),
});

/** 训练计划 —— 按训练循环列训练日；有源挂引用，没有就显式无源 */
export const PlanCardSchema = z.object({
  kind: z.literal('plan'),
  title: z.string(),
  split: z.string(),
  cycle: z.string(),
  days: z.array(PlanDaySchema).min(1).max(7),
  notes: z.array(z.string()),
  ai_generated: z.boolean(),
  citations: z.array(CitationSchema),
  basis: z.array(KnowledgeClaimSchema),
  has_source: z.boolean(),
  no_source_notice: z.string().nullable(),
});

export const RefusalCardSchema = z.object({
  kind: z.literal('refusal'),
  reply: z.string(),
  reason: RefusalReasonSchema,
});

/** 非目标用户（未成年 / 有基础疾病 / 伤病）的出口 */
export const BoundaryCardSchema = z.object({
  kind: z.literal('boundary'),
  reply: z.string(),
});

/** 窄修正：最近一次记录里只有旧重量 Y 的动作被改成了 X（措辞与友好文案在展示层） */
export const CorrectionCardSchema = z.object({
  kind: z.literal('correction'),
  session_id: z.string(),
  date: z.string(),
  split_label: z.string().nullable(),
  /** 被改的那一行在 exercises 里的下标 —— 展示层画删除线旧值 */
  exercise_index: z.number().int(),
  old_weight_kg: z.number(),
  new_weight_kg: z.number(),
  corrected_sets: z.number().int(),
  exercises: z.array(WorkoutCardExerciseSchema),
  volume_kg: z.number(),
  working_sets: z.number().int(),
});

/** 体重记录 —— 数值已落库，卡片只回算好的日期与数字 */
export const WeightCardSchema = z.object({
  kind: z.literal('weight'),
  date: z.string(),
  weight_kg: z.number(),
});

export const TurnCardSchema = z.discriminatedUnion('kind', [
  WorkoutCardSchema,
  MealCardSchema,
  ChatCardSchema,
  KnowledgeCardSchema,
  PlanCardSchema,
  RefusalCardSchema,
  BoundaryCardSchema,
  CorrectionCardSchema,
  WeightCardSchema,
]);

/** 评估查到哪一步 —— 屏 11 靠它区分「没记录 / 数据不足」 */
export const AssessmentLookupSchema = z.object({
  status: z.enum(['ok', 'none', 'not_found', 'insufficient']),
  missing: z.array(z.string()),
});

export const TurnResponseSchema = z.object({
  turn_id: z.string(),
  /** 本轮所属会话 —— 刷新后按它恢复 */
  conversation_id: z.string(),
  intent: IntentSchema,
  /** 没产生卡片的轮次（只求评估 / 红线条目）为 null */
  card: TurnCardSchema.nullable(),
  /** 评估是独立字段，不塞进卡片 union —— 混合意图时 card 与 assessment 同时有值 */
  assessment: AssessmentCardSchema.nullable(),
  /** 本轮要了评估时，带上查找结果；没要评估为 null */
  assessment_lookup: AssessmentLookupSchema.nullable(),
  /** 补充提示，至多 1 条；后置、可选，不拦截录入 */
  notices: z.array(z.string()),
});

export const TurnRequestSchema = z.object({
  message: z.string().min(1),
  conversation_id: z.string().uuid().nullable().optional(),
});

export type RefusalReason = z.infer<typeof RefusalReasonSchema>;
export type WorkoutCardSet = z.infer<typeof WorkoutCardSetSchema>;
export type WorkoutCardExercise = z.infer<typeof WorkoutCardExerciseSchema>;
export type WorkoutCard = z.infer<typeof WorkoutCardSchema>;
export type MealCard = z.infer<typeof MealCardSchema>;
export type ChatCard = z.infer<typeof ChatCardSchema>;
export type KnowledgeClaim = z.infer<typeof KnowledgeClaimSchema>;
export type KnowledgeCard = z.infer<typeof KnowledgeCardSchema>;
export type PlanExercise = z.infer<typeof PlanExerciseSchema>;
export type PlanDay = z.infer<typeof PlanDaySchema>;
export type PlanCard = z.infer<typeof PlanCardSchema>;
export type RefusalCard = z.infer<typeof RefusalCardSchema>;
export type BoundaryCard = z.infer<typeof BoundaryCardSchema>;
export type CorrectionCard = z.infer<typeof CorrectionCardSchema>;
export type WeightCard = z.infer<typeof WeightCardSchema>;
export type AssessmentLookup = z.infer<typeof AssessmentLookupSchema>;
export type TurnCard = z.infer<typeof TurnCardSchema>;
export type TurnResponse = z.infer<typeof TurnResponseSchema>;
export type TurnRequest = z.infer<typeof TurnRequestSchema>;