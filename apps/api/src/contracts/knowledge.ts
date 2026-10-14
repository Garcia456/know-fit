import { z } from 'zod';

/**
 * 采集结果的**对外契约** —— 只有元数据与计数。
 *
 * 🔴 本文件任何 schema 都不携带转写原文。护栏 R-B 会拦下 text / content / transcript
 *    这组字段名；运行期那条（遍历响应体断言）仍挂 dev-005。
 */

export const IngestedSourceSchema = z.object({
  source_id: z.string(),
  platform: z.string(),
  platform_video_key: z.string(),
  video_id: z.string(),
  creator: z.string(),
  title: z.string(),
  original_url: z.string(),
  topic_domain: z.string().nullable(),
  duration_sec: z.number().nullable(),
  published_at: z.string().nullable(),
  subtitle_source: z.string(),
  /** 转写分了几段 —— 只报数量，不报内容 */
  segment_count: z.number().int(),
  fetched_at: z.string(),
  robots_checked_at: z.string(),
  robots_allowed: z.boolean().nullable(),
  is_indexable: z.boolean(),
  compliance_status: z.string(),
});
export type IngestedSource = z.infer<typeof IngestedSourceSchema>;

/** 下架报告 —— 前后行数摆在一起，让「清掉了」可被指认 */
export const RetireReportSchema = z.object({
  source_id: z.string(),
  is_indexable: z.boolean(),
  compliance_status: z.string(),
  sources_before: z.number().int(),
  sources_after: z.number().int(),
  segments_before: z.number().int(),
  segments_after: z.number().int(),
});
export type RetireReport = z.infer<typeof RetireReportSchema>;