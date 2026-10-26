import type { VolumeHook } from '../contracts/metrics.js';
import type { LlmClient } from '../llm/client.js';
import {
  GateBatchSchema,
  checkGateResult,
  type GateCheck,
  type GateClaim,
  type GateResult,
} from './gate.js';
import { GATE_SYSTEM, gateInput } from './prompts.js';

/**
 * 闸② 的调用层：每条 claim 单独一次请求，并发发。
 *
 * 🔴 不合批 —— 实测 2 条合批比并行慢 1.4s（2026-10-26）。
 * 任一条调用失败按不支撑处理，整条建议照样降级（all-or-nothing 不变）。
 */

export interface ClaimVerdict {
  claim: GateClaim;
  check: GateCheck;
  /** 模型原始返回；调用失败为 null（报告要用 from_window 显示窗口区间） */
  raw: GateResult | null;
}

export async function verifyClaims(
  llm: LlmClient,
  verdict: VolumeHook,
  claims: GateClaim[],
): Promise<ClaimVerdict[]> {
  return Promise.all(
    claims.map(async (claim) => {
      const base = { claim_id: claim.claim_id, candidate_id: claim.candidate_id, from_window: 0 };
      try {
        const out = await llm.structured({
          system: GATE_SYSTEM,
          input: gateInput(verdict, [claim]),
          schema: GateBatchSchema,
          name: 'verify_citation',
        });
        const raw = out.results[0] ?? null;
        return {
          claim,
          raw,
          check: checkGateResult({
            result: raw ?? { ...base, supported: false, reason: '闸② 没给出结果' },
            claim,
            verdict,
          }),
        };
      } catch {
        return {
          claim,
          raw: null,
          check: checkGateResult({
            result: { ...base, supported: false, reason: '闸② 调用失败' },
            claim,
            verdict,
          }),
        };
      }
    }),
  );
}