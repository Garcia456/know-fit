import { describe, expect, it } from 'vitest';
import { checkGateResult, numbersAllowed, numbersIn } from './gate.js';
import { buildGateWindows, type GateWindow } from './windows.js';
import { buildVolumeHook } from '../metrics/hook.js';

/**
 * 闸② 的确定性部分 —— LLM 说支撑不算数。
 * 模型只返回窗口编号，引文由服务端按偏移切出来。
 */

const CHUNK = '这次先把训练容量稳住，下周再考虑加重量。离心放慢一点，动作质量优先。';
const VERDICT = buildVolumeHook({ current: 2000, baseline: 2500, split_label: '推日' });
const WINDOWS = buildGateWindows({ chunk_text: CHUNK, start_ts: 0, end_ts: 1, segments: null });
const CLAIM = {
  claim_id: 'C0',
  candidate_id: 'K0',
  claim: '先把训练节奏稳住，再考虑加重量',
  chunk_text: CHUNK,
  windows: WINDOWS,
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    claim_id: 'C0',
    candidate_id: 'K0',
    supported: true,
    from_window: 0,
    reason: '片段直接支撑',
    ...overrides,
  };
}

function win(start: number, end: number, index: number, text: string): GateWindow {
  return { index, start, end, text };
}

describe('buildGateWindows', () => {
  it('按 ASR 段边界切，段拼不回原文就退回按字切', () => {
    const text = '一二三四五六七八九十'.repeat(12); // 120 字
    const segments = Array.from({ length: 12 }, (_, i) => ({
      start_ts: i,
      end_ts: i + 1,
      text: '一二三四五六七八九十',
    }));
    const seg = buildGateWindows({ chunk_text: text, start_ts: 0, end_ts: 12, segments });
    expect(seg.map((w) => w.text).join('')).toBe(text);
    expect(seg.every((w) => w.text.length <= 40)).toBe(true);

    const broken = buildGateWindows({ chunk_text: text, start_ts: 0, end_ts: 12, segments: [segments[0]!] });
    expect(broken.map((w) => w.text).join('')).toBe(text);
  });

  it('窗口偏移能还原原文', () => {
    for (const w of WINDOWS) expect(CHUNK.slice(w.start, w.end)).toBe(w.text);
  });
});

describe('checkGateResult', () => {
  it('窗口合法 + 长度合规 → 支撑，偏移能在原文里还原', () => {
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

  it('起点越界 → 不支撑', () => {
    for (const from_window of [99, -1]) {
      const out = checkGateResult({ result: result({ from_window }), claim: CLAIM, verdict: VERDICT });
      expect(out.supported).toBe(false);
      expect(out.reason).toContain('起点');
    }
  });

  it('从起点起最多取 3 个窗口 —— 终点不受模型控制', () => {
    const four = [
      win(0, 10, 0, '1234567890'),
      win(10, 30, 1, '12345678901234567890'),
      win(30, 50, 2, '12345678901234567890'),
      win(50, 60, 3, '1234567890'),
    ];
    const chunk = four.map((w) => w.text).join('');
    const out = checkGateResult({
      result: result({ from_window: 0 }),
      claim: { ...CLAIM, chunk_text: chunk, windows: four },
      verdict: VERDICT,
    });
    expect(out.supported).toBe(true);
    expect(out.quote).toBe(four.slice(0, 3).map((w) => w.text).join(''));
    expect(out.quote_end).toBe(50);
  });

  it('引文太短 / 太长 → 不支撑', () => {
    const short = [win(0, 5, 0, '一二三四五')];
    expect(
      checkGateResult({
        result: result(),
        claim: { ...CLAIM, chunk_text: '一二三四五', windows: short },
        verdict: VERDICT,
      }).supported,
    ).toBe(false);

    const long = [
      win(0, 70, 0, '甲'.repeat(70)),
      win(70, 140, 1, '乙'.repeat(70)),
      win(140, 210, 2, '丙'.repeat(70)),
    ];
    const out = checkGateResult({
      result: result({ from_window: 0 }),
      claim: { ...CLAIM, chunk_text: long.map((w) => w.text).join(''), windows: long },
      verdict: VERDICT,
    });
    expect(out.supported).toBe(false);
    expect(out.reason).toContain('太长');
  });

  it('窗口偏移与原文对不上 → 不支撑（防御）', () => {
    const wrong = [win(0, 10, 0, '和原文完全不一样的十个字')];
    const out = checkGateResult({
      result: result(),
      claim: { ...CLAIM, chunk_text: CHUNK, windows: wrong },
      verdict: VERDICT,
    });
    expect(out.supported).toBe(false);
    expect(out.reason).toContain('对不上');
  });

  it('取到首端 / 末端都不越界', () => {
    const chunk = '这是开头的一句话说明情况。后半段再给出一条更长的可引用建议。';
    const windows = buildGateWindows({ chunk_text: chunk, start_ts: 0, end_ts: 1, segments: null });
    const claim = { ...CLAIM, chunk_text: chunk, windows };

    const first = checkGateResult({ result: result(), claim, verdict: VERDICT });
    expect(first.quote_start).toBe(0);
    expect(chunk.slice(first.quote_start!, first.quote_end!)).toBe(first.quote);

    const lastIndex = windows.length - 1;
    const last = checkGateResult({
      result: result({ from_window: lastIndex }),
      claim,
      verdict: VERDICT,
    });
    expect(last.quote_end).toBe(chunk.length);
    expect(chunk.slice(last.quote_start!, last.quote_end!)).toBe(last.quote);
  });

  it('数字来自判定 → 放行', () => {
    const out = checkGateResult({
      result: result(),
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