import { describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../llm/client.js';
import { buildVolumeHook } from '../metrics/hook.js';
import type { GateClaim } from './gate.js';
import { verifyClaims } from './verify.js';

const VERDICT = buildVolumeHook({ current: 2000, baseline: 2500, split_label: '推日' });

function claim(id: string): GateClaim {
  return {
    claim_id: id,
    claim: '把训练节奏稳住',
    candidate_id: 'K0',
    chunk_text: '这是一个足够长的片段文本用于测试',
    windows: [{ index: 0, start: 0, end: 16, text: '这是一个足够长的片段文本用于测试' }],
  };
}

function client(impl: (input: string) => Promise<unknown>): LlmClient {
  return {
    model: 'test',
    async structured(req) {
      return req.schema.parse(await impl(req.input));
    },
    async generate() {
      return '';
    },
  };
}

const ok = (claimId: string) => ({
  results: [{ claim_id: claimId, candidate_id: 'K0', supported: true, from_window: 0, reason: '支撑' }],
});

describe('verifyClaims', () => {
  it('两条 claim 并发发出，而不是串行', async () => {
    let active = 0;
    let peak = 0;
    const llm = client(async (input) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return ok(input.includes('C0') ? 'C0' : 'C1');
    });

    const out = await verifyClaims(llm, VERDICT, [claim('C0'), claim('C1')]);

    expect(peak).toBe(2);
    expect(out.map((v) => v.check.supported)).toEqual([true, true]);
  });

  it('每次调用只带一条 claim', async () => {
    const inputs: string[] = [];
    const llm = client(async (input) => {
      inputs.push(input);
      return ok('C0');
    });

    await verifyClaims(llm, VERDICT, [claim('C0'), claim('C1')]);

    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.match(/<建议 /g)).toHaveLength(1);
    }
  });

  it('一条调用失败 → 那条不支撑，另一条不受影响（整条建议仍会降级）', async () => {
    const llm = client(async (input) => {
      if (input.includes('C0')) throw new Error('boom');
      return ok('C1');
    });

    const out = await verifyClaims(llm, VERDICT, [claim('C0'), claim('C1')]);

    expect(out[0]!.check.supported).toBe(false);
    expect(out[0]!.raw).toBeNull();
    expect(out[0]!.check.reason).toContain('调用失败');
    expect(out[1]!.check.supported).toBe(true);
  });

  it('模型没回结果 → 不支撑', async () => {
    const llm = client(async () => ({ results: [] }));

    const out = await verifyClaims(llm, VERDICT, [claim('C0')]);

    expect(out[0]!.check.supported).toBe(false);
    expect(out[0]!.check.reason).toContain('没给出结果');
  });

  it('没有 claim → 一次调用都不发', async () => {
    const spy = vi.fn(async () => ({ results: [] }));
    const llm = client(spy);

    const out = await verifyClaims(llm, VERDICT, []);

    expect(out).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('知识问答（判定为 null）→ 提示词里没有判定行，但引文校验照旧', async () => {
    let input = '';
    const llm = client(async (text) => {
      input = text;
      return ok('C0');
    });

    const out = await verifyClaims(llm, null, [claim('C0')]);

    expect(input).not.toContain('判定：');
    expect(out[0]!.check.supported).toBe(true);
  });

  it('判定为 null 时数字仍要能在引文里找到', async () => {
    const llm = client(async () => ok('C0'));
    const withNumber = { ...claim('C0'), claim: '每组做 12 次' };

    const out = await verifyClaims(llm, null, [withNumber]);

    expect(out[0]!.check.supported).toBe(false);
    expect(out[0]!.check.reason).toContain('数字');
  });

  it('闸② 提示词要求 reason 短', async () => {
    let system = '';
    const llm: LlmClient = {
      async structured(req) {
        system = req.system;
        return req.schema.parse(ok('C0'));
      },
      async generate() {
        return '';
      },
    };

    await verifyClaims(llm, VERDICT, [claim('C0')]);

    expect(system).toContain('reason 不超过 10 个字');
  });
});