import { describe, expect, it } from 'vitest';
import { checkGateResult, numbersAllowed, numbersIn } from './gate.js';
import { buildVolumeHook } from '../metrics/hook.js';

/**
 * 闸② 的确定性部分 —— LLM 说支撑不算数。
 */

const CHUNK = '这次先把训练容量稳住，下周再考虑加重量。离心放慢一点，动作质量优先。';
const VERDICT = buildVolumeHook({ current: 2000, baseline: 2500, split_label: '推日' });
const CLAIM = {
  claim_id: 'C0',
  candidate_id: 'K0',
  claim: '先把训练节奏稳住，再考虑加重量',
  chunk_text: CHUNK,
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    claim_id: 'C0',
    candidate_id: 'K0',
    supported: true,
    supporting_quote: '先把训练容量稳住，下周再考虑加重量',
    reason: '片段直接支撑',
    ...overrides,
  };
}

describe('checkGateResult', () => {
  it('逐字子串 + 长度合规 → 支撑，偏移能在原文里还原', () => {
    const out = checkGateResult({ result: result(), claim: CLAIM, verdict: VERDICT });
    expect(out.supported).toBe(true);
    expect(CHUNK.slice(out.quote_start!, out.quote_end!)).toBe(out.quote);
  });

  it('LLM 说不支撑 → 不支撑', () => {
    const out = checkGateResult({ result: result({ supported: false }), claim: CLAIM, verdict: VERDICT });
    expect(out.supported).toBe(false);
    expect(out.reason).toContain('片段直接支撑');
  });

  it('id 对不上 → 不支撑（防止结果串位）', () => {
    const out = checkGateResult({ result: result({ claim_id: 'C9' }), claim: CLAIM, verdict: VERDICT });
    expect(out.supported).toBe(false);
    expect(out.reason).toContain('id');
  });

  it('支撑句太短 / 太长 → 不支撑', () => {
    expect(checkGateResult({ result: result({ supporting_quote: '稳住' }), claim: CLAIM, verdict: VERDICT }).supported).toBe(false);
    const long = '稳住'.repeat(80);
    expect(
      checkGateResult({ result: result({ supporting_quote: long }), claim: CLAIM, verdict: VERDICT }).supported,
    ).toBe(false);
  });

  it('支撑句不是原文连续子串 → 不支撑（改写也算编）', () => {
    const out = checkGateResult({
      result: result({ supporting_quote: '把训练容量稳定住，下周再加重量' }),
      claim: CLAIM,
      verdict: VERDICT,
    });
    expect(out.supported).toBe(false);
    expect(out.reason).toContain('连续子串');
  });

  it('建议里的数字在判定与支撑句里都找不到 → 不支撑', () => {
    const out = checkGateResult({
      result: result(),
      claim: { ...CLAIM, claim: '下次直接加到 120kg' },
      verdict: VERDICT,
    });
    expect(out.supported).toBe(false);
    expect(out.reason).toContain('数字');
  });

  it('「加 2.5kg」这种小数也算编数字', () => {
    const out = checkGateResult({
      result: result(),
      claim: { ...CLAIM, claim: '下次加 2.5kg' },
      verdict: VERDICT,
    });
    expect(out.supported).toBe(false);
    expect(out.reason).toContain('数字');
  });

  it('偏移边界：取到首端 / 末端都不越界', () => {
    const chunk = '这是开头的一句话说明情况。后半段再给出一条更长的可引用建议。';
    const claim = { ...CLAIM, chunk_text: chunk };

    const first = checkGateResult({
      result: result({ supporting_quote: '这是开头的一句话说明情况。' }),
      claim,
      verdict: VERDICT,
    });
    expect(first.quote_start).toBe(0);
    expect(chunk.slice(first.quote_start!, first.quote_end!)).toBe('这是开头的一句话说明情况。');

    const last = checkGateResult({
      result: result({ supporting_quote: '后半段再给出一条更长的可引用建议。' }),
      claim,
      verdict: VERDICT,
    });
    expect(last.quote_end).toBe(chunk.length);
    expect(chunk.slice(last.quote_start!, last.quote_end!)).toBe('后半段再给出一条更长的可引用建议。');
  });

  it('数字来自判定 → 放行', () => {
    const out = checkGateResult({
      result: result({ supporting_quote: '这次先把训练容量稳住，下周再考虑加重量' }),
      claim: { ...CLAIM, claim: '这次是 2000kg，先把节奏稳住' },
      verdict: VERDICT,
    });
    expect(out.supported).toBe(true);
  });
});

describe('数字守卫', () => {
  it('numbersIn 把负数按绝对值取', () => {
    expect(numbersIn({ delta_pct: -20 })).toEqual([20]);
  });

  it('每个数字都要在 allowed 里', () => {
    expect(numbersAllowed('从 2000 到 2500', [2000, 2500])).toBe(true);
    expect(numbersAllowed('从 2000 到 2600', [2000, 2500])).toBe(false);
    expect(numbersAllowed('没有数字', [])).toBe(true);
  });
});
