import { z } from 'zod';
import type { VolumeHook } from '../contracts/metrics.js';
import type { LlmClient } from '../llm/client.js';
import { QUERY_SYSTEM } from './prompts.js';

/**
 * 从判定生成检索 query —— 模板优先，LLM 只在模板未命中时兜底。
 *
 * 🔴 query 里不放原始数字：数字会让 embedding 偏向字面，而不是语义。
 *    方向与量级已经体现在模板词里（下降 / 上涨 / 停滞）。
 */

export type QuerySource = 'template' | 'llm' | 'fallback';

export const FALLBACK_QUERY = '训练 容量 调整';

const QueryResultSchema = z.object({ query: z.string() });

export function templateQuery(
  verdict: VolumeHook,
  goal: string | null,
  bodyParts: readonly string[] = [],
): string | null {
  const split = verdict.scope.split_label;
  const delta = verdict.delta_pct;
  if (!split || delta === null) return null;

  const prefix = goal?.trim() ? goal.trim() : '训练';
  const parts = bodyParts.length > 0 ? ` ${bodyParts.join(' ')}` : '';
  if (delta <= -10) return `${prefix} ${split}${parts} 训练容量下降 怎么调整`;
  if (delta >= 10) return `${prefix} ${split}${parts} 训练容量上涨 要不要加量`;
  return `${prefix} ${split}${parts} 训练容量停滞 怎么突破`;
}

function usableFallbackQuery(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length > 0 && trimmed.length <= 200 && !/\d/.test(trimmed);
}

export async function buildQuery(
  verdict: VolumeHook,
  goal: string | null,
  llm: LlmClient,
  bodyParts: readonly string[] = [],
): Promise<{ query: string; source: QuerySource }> {
  const templated = templateQuery(verdict, goal, bodyParts);
  if (templated) return { query: templated, source: 'template' };

  try {
    const out = await llm.structured({
      system: QUERY_SYSTEM,
      input: JSON.stringify({ verdict }),
      schema: QueryResultSchema,
      name: 'build_query',
    });
    if (usableFallbackQuery(out.query)) return { query: out.query.trim(), source: 'llm' };
  } catch {
    // 兜底失败不是错误：模板没命中时还有一个确定性的最后兜底
  }
  return { query: FALLBACK_QUERY, source: 'fallback' };
}