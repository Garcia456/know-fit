import { z } from 'zod';
import { AssessmentCardSchema } from '../contracts/assessment.js';
import { ExtractionSchema, IntentSchema, MissingFieldSchema, RecordStatusSchema } from '../contracts/extraction.js';
import {
  AssessmentLookupSchema,
  TurnCardSchema,
  WorkoutCardExerciseSchema,
} from '../contracts/turn.js';
import { GuardVerdictSchema } from './guard.js';

/**
 * 图的 State。
 * 评估是独立字段（不是卡片 union 的一员）；chunk 全文**不进**这里。
 */

/** v1 单用户 —— 迁移里种下的那个固定 id */
export const SINGLE_USER_ID = '00000000-0000-4000-8000-000000000001';

export const TrainingBandSchema = z.enum(['lt_3m', '3m_2y', 'gt_2y']);

/** 会话上下文 —— 由服务层从库里读最近 6 轮，前端不传 */
export const TurnHistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const TurnState = z.object({
  message: z.string(),
  user_id: z.string().default(SINGLE_USER_ID),
  history: z.array(TurnHistoryItemSchema).default([]),
  /** 由调用方从 user_profile 带进来 —— 边界判定要用，图里不读库 */
  training_years_band: TrainingBandSchema.default('3m_2y'),

  guard_verdict: GuardVerdictSchema.default('pass'),
  intent: IntentSchema.default('chat'),
  extracted: ExtractionSchema.nullable().default(null),
  /** 抽到了 workout 但一个动作都没有 —— 不落库，走追问 */
  empty_extraction: z.boolean().default(false),

  record_ref: z.object({ type: z.enum(['workout', 'meal']), id: z.string() }).nullable().default(null),
  record_status: RecordStatusSchema.nullable().default(null),
  missing_fields: z.array(MissingFieldSchema).default([]),
  session_date: z.string().nullable().default(null),
  /** 规范化后的动作 —— 卡片与落库共用一份，避免两处各归一次 */
  card_exercises: z.array(WorkoutCardExerciseSchema).default([]),

  card: TurnCardSchema.nullable().default(null),
  /** 纯评估 / 混合意图的评估结果；没有评估时为 null */
  assessment: AssessmentCardSchema.nullable().default(null),
  /** 评估查到哪一步（屏 11 用）；没要评估时为 null */
  assessment_lookup: AssessmentLookupSchema.nullable().default(null),
  notices: z.array(z.string()).default([]),
});

export type TurnStateValue = z.infer<typeof TurnState>;
export type TurnHistoryItem = z.infer<typeof TurnHistoryItemSchema>;
export type TrainingBand = z.infer<typeof TrainingBandSchema>;