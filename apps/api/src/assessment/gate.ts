import { z } from 'zod';
import type { VolumeHook } from '../contracts/metrics.js';

/**
 * 闸② 的确定性校验 —— LLM 说「支撑」不算数。
 *
 * 一条引用要同时满足：
 *   ① 支撑句是片段原文的连续子串；
 *   ② 支撑句 12–120 字；
 *   ③ 建议里的数字必须能在判定或支撑句里找到（防数字幻觉）。
 * 任一条不过 → 不支撑；解析失败 / 超时也按不支撑（fail-closed）。
 */

export const GATE_QUOTE_MIN = 12;
export const GATE_QUOTE_MAX = 120;

export const GateResultSchema = z.object({
  claim_id: z.string(),
  candidate_id: z.string(),
  supported: z.boolean(),
  supporting_quote: z.string(),
  reason: z.string(),
});

export const GateBatchSchema = z.object({ results: z.array(GateResultSchema) });

export const GateCheckSchema = z.object({
  claim_id: z.string(),
  candidate_id: z.string(),
  supported: z.boolean(),
  quote: z.string(),
  quote_start: z.number().int().nullable(),
  quote_end: z.number().int().nullable(),
  reason: z.string(),
});

export type GateCheck = z.infer<typeof GateCheckSchema>;

export interface GateClaim {
  claim_id: string;
  claim: string;
  candidate_id: string;
  chunk_text: string;
}

export function numbersIn(value: unknown): number[] {
  const raw = JSON.stringify(value);
  const matches = raw.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return matches.map((m) => Math.abs(Number(m)));
}

/** 建议里的每个数字都要能在 allowed 里找到 —— 找不到就是编的 */
export function numbersAllowed(claim: string, allowed: number[]): boolean {
  const nums = numbersIn(claim);
  const set = new Set(allowed);
  return nums.every((n) => set.has(n));
}

export function checkGateResult(input: {
  result: { claim_id: string; candidate_id: string; supported: boolean; supporting_quote: string; reason: string };
  claim: GateClaim;
  verdict: VolumeHook;
}): GateCheck {
  const { result, claim, verdict } = input;
  const fail = (reason: string): GateCheck => ({
    claim_id: claim.claim_id,
    candidate_id: claim.candidate_id,
    supported: false,
    quote: '',
    quote_start: null,
    quote_end: null,
    reason,
  });

  if (result.claim_id !== claim.claim_id || result.candidate_id !== claim.candidate_id) {
    return fail('id 对不上');
  }
  if (!result.supported) return fail(result.reason || 'LLM 判定不支撑');

  const quote = result.supporting_quote.trim();
  if (quote.length < GATE_QUOTE_MIN) return fail(`支撑句太短（${quote.length} 字）`);
  if (quote.length > GATE_QUOTE_MAX) return fail(`支撑句太长（${quote.length} 字）`);
  const start = claim.chunk_text.indexOf(quote);
  if (start < 0) return fail('支撑句不是片段原文的连续子串');

  // 数字守卫：建议里的数字必须来自判定或支撑句
  if (!numbersAllowed(claim.claim, [...numbersIn(verdict), ...numbersIn(quote)])) {
    return fail('建议里有判定与支撑句都没有的数字');
  }

  return {
    claim_id: claim.claim_id,
    candidate_id: claim.candidate_id,
    supported: true,
    quote,
    quote_start: start,
    quote_end: start + quote.length,
    reason: result.reason,
  };
}