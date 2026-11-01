import { z } from 'zod';
import { VolumeHookSchema } from './metrics.js';

/**
 * 对外契约：一次评估。
 *
 * 🔴 全部字段名已避开全文型字段名（text / content / transcript）——
 *    对外只给逐字短引用，不给知识片原文。
 * `short_quote` 是唯一允许出现的原文片段。
 */

export const CitationSchema = z.object({
  citation_id: z.string(),
  creator: z.string(),
  title: z.string(),
  url: z.string(), // 视频级链接；start_ts 只作展示
  start_ts: z.number(),
  short_quote: z.string(), // 逐字原话，已过闸②
});

export const AdviceClaimSchema = z.object({
  claim: z.string(),
  basis: z.enum(['personal_data', 'source']),
  citation_id: z.string().nullable(), // source claim 必有；personal 必为 null
});

export const AssessmentCardSchema = z.object({
  kind: z.literal('assessment'),
  assessment_id: z.string(),
  trigger: z.enum(['explicit', 'hook']),
  verdict: VolumeHookSchema,
  advice: z.string(),
  advice_claims: z.array(AdviceClaimSchema),
  has_source: z.boolean(),
  citations: z.array(CitationSchema),
  no_source_notice: z.string().nullable(),
});

export const AssessmentRequestSchema = z.object({
  related_record_id: z.string().uuid().nullable().optional(),
  trigger: z.enum(['explicit', 'hook']).default('explicit'),
});

export const AssessmentResponseSchema = z.object({
  card: AssessmentCardSchema.nullable(),
  notices: z.array(z.string()),
  /** 查到了哪一步：屏 11 据此决定是否画「数据不足」卡 */
  lookup_status: z.enum(['ok', 'none', 'not_found', 'insufficient']),
  /** 算不出判定时缺什么（sets / split_label / baseline），由后端说 */
  missing: z.array(z.string()),
});

export type Citation = z.infer<typeof CitationSchema>;
export type AdviceClaim = z.infer<typeof AdviceClaimSchema>;
export type AssessmentCard = z.infer<typeof AssessmentCardSchema>;
export type AssessmentRequest = z.infer<typeof AssessmentRequestSchema>;
export type AssessmentResponse = z.infer<typeof AssessmentResponseSchema>;