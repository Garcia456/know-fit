import { z } from 'zod';
import type { VolumeHook } from '../contracts/metrics.js';
import { windowSpan, type GateWindow } from './windows.js';

/**
 * 闸② 的确定性校验 —— LLM 说「支撑」不算数。
 *
 * 模型只返回**起点的窗口编号**，不返回原文、也不返回终点；
 * 引文由服务端从起点起取最多 3 个窗口切出来。一条引用要同时满足：
 *   ① 起点编号合法；
 *   ② 切出来的引文 12–120 字，且与片段原文逐字一致；
 *   ③ 建议里的数字必须能在判定或引文里找到（防数字幻觉）。
 * 任一条不过 → 不支撑；解析失败 / 超时也按不支撑（fail-closed）。
 */

export const GATE_QUOTE_MIN = 12;
export const GATE_QUOTE_MAX = 120;

export const GateResultSchema = z.object({
  claim_id: z.string(),
  candidate_id: z.string(),
  supported: z.boolean(),
  from_window: z.number().int().nonnegative(),
  reason: z.string(),
});

export const GateBatchSchema = z.object({ results: z.array(GateResultSchema) });

export type GateResult = z.infer<typeof GateResultSchema>;

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
  windows: GateWindow[];
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
  result: { claim_id: string; candidate_id: string; supported: boolean; from_window: number; reason: string };
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

  const range = windowSpan(claim.windows, result.from_window);
  if (!range) return fail('起点窗口编号不合法');
  const quote = range.text;
  if (quote.length < GATE_QUOTE_MIN) return fail(`引文太短（${quote.length} 字）`);
  if (quote.length > GATE_QUOTE_MAX) return fail(`引文太长（${quote.length} 字）`);
  // 防御：窗口偏移必须真的能在片段原文里切出同一段
  if (claim.chunk_text.slice(range.start, range.end) !== quote) {
    return fail('窗口偏移与片段原文对不上');
  }

  // 数字守卫：建议里的数字必须来自判定或引文
  if (!numbersAllowed(claim.claim, [...numbersIn(verdict), ...numbersIn(quote)])) {
    return fail('建议里有判定与引文都没有的数字');
  }

  return {
    claim_id: claim.claim_id,
    candidate_id: claim.candidate_id,
    supported: true,
    quote,
    quote_start: range.start,
    quote_end: range.end,
    reason: result.reason,
  };
}