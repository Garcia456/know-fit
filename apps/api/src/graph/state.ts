import { z } from 'zod';
import { ExtractionSchema, IntentSchema, MissingFieldSchema, RecordStatusSchema } from '../contracts/extraction.js';
import { TurnCardSchema, WorkoutCardExerciseSchema } from '../contracts/turn.js';
import { GuardVerdictSchema } from './guard.js';

/**
 * 图的 State（feat-006 §2.2 的 dev-002 子集）。
 * 评估侧那几项（metrics / citations / hook）不在这里 —— 它们随 dev-003 / dev-005 进来。
 */

/** v1 单用户 —— 迁移里种下的那个固定 id */
export const SINGLE_USER_ID = '00000000-0000-4000-8000-000000000001';

export const TrainingBandSchema = z.enum(['lt_3m', '3m_2y', 'gt_2y']);

export const TurnState = z.object({
  message: z.string(),
  user_id: z.string().default(SINGLE_USER_ID),
  /** 由调用方从 user_profile 带进来 —— 边界判定要用，图里不读库 */
  training_years_band: TrainingBandSchema.default('3m_2y'),

  guard_verdict: GuardVerdictSchema.default('pass'),
  intent: IntentSchema.default('chat'),
  extracted: ExtractionSchema.nullable().default(null),

  record_ref: z.object({ type: z.enum(['workout', 'meal']), id: z.string() }).nullable().default(null),
  record_status: RecordStatusSchema.nullable().default(null),
  missing_fields: z.array(MissingFieldSchema).default([]),
  session_date: z.string().nullable().default(null),
  /** 规范化后的动作 —— 卡片与落库共用一份，避免两处各归一次 */
  card_exercises: z.array(WorkoutCardExerciseSchema).default([]),

  card: TurnCardSchema.nullable().default(null),
  notices: z.array(z.string()).default([]),
});

export type TurnStateValue = z.infer<typeof TurnState>;
export type TrainingBand = z.infer<typeof TrainingBandSchema>;