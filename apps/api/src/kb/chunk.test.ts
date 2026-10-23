import { describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK_OPTIONS, chunkTranscript, endsSentence } from './chunk.js';
import type { ChunkOptions } from './chunk.js';
import type { TranscriptSegment } from './types.js';

/**
 * 切片是纯函数 —— 这里验的只是「规则照定义跑了」：
 * 不切开一段 / 字数在范围内 / 重叠 / 并片 / 超长 / 时间戳。
 * 🔴 「切出来的片是不是一个完整观点」只能由作者肉眼看。
 */

const SENTENCE_END = '。';

/** 造 n 段、每段 len 个字的转写；每段的起止秒按 1.5s 递增 */
function makeSegments(n: number, len = 10, endsWithPeriod = true): TranscriptSegment[] {
  return Array.from({ length: n }, (_, i) => {
    const body = '啊'.repeat(Math.max(0, len - (endsWithPeriod ? 1 : 0)));
    return {
      start_ts: i * 1.5,
      end_ts: (i + 1) * 1.5,
      text: endsWithPeriod ? body + SENTENCE_END : body,
      confidence: 0.9,
    };
  });
}

const joinRange = (segs: TranscriptSegment[], from: number, to: number): string =>
  segs.slice(from, to + 1).map((s) => s.text).join('');

describe('chunkTranscript：边界与长度', () => {
  it('空输入返回空数组（不炸）', () => {
    expect(chunkTranscript([])).toEqual([]);
  });

  it('全是空白段 → 空数组', () => {
    expect(chunkTranscript([{ start_ts: 0, end_ts: 1, text: '   ', confidence: null }])).toEqual([]);
  });

  it('每片都落在段边界上 —— 不切开一段', () => {
    const segs = makeSegments(100);
    const chunks = chunkTranscript(segs);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text).toBe(joinRange(segs, c.first_segment, c.last_segment));
      expect(c.start_ts).toBe(segs[c.first_segment]!.start_ts);
      expect(c.end_ts).toBe(segs[c.last_segment]!.end_ts);
    }
  });

  it('非末片的字数落在 300–600 之间', () => {
    const chunks = chunkTranscript(makeSegments(100));
    for (const c of chunks.slice(0, -1)) {
      expect(c.text.length).toBeGreaterThanOrEqual(DEFAULT_CHUNK_OPTIONS.minChars);
      expect(c.text.length).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.maxChars);
    }
  });

  it('相邻片的重叠在 10–15% 量级（段粒度误差内）', () => {
    const chunks = chunkTranscript(makeSegments(100));
    const ratios = chunks.slice(1).map((c) => c.overlap_chars / c.text.length);
    expect(Math.min(...ratios)).toBeGreaterThan(0.05);
    expect(Math.max(...ratios)).toBeLessThan(0.2);
  });

  it('最后一片低于下限时并进前一片，不留下半句话', () => {
    // 31 段 × 10 字 = 310 字：第一片 300，尾巴只剩 40 字 → 必须并回去
    const chunks = chunkTranscript(makeSegments(31));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.length).toBe(310);
    expect(chunks[0]!.notes.some((n) => n.includes('低于下限'))).toBe(true);
  });

  it('单段超长时独占一片并记 note（不切开一段）', () => {
    const segs: TranscriptSegment[] = [
      { start_ts: 0, end_ts: 10, text: '长'.repeat(700), confidence: 0.8 },
      { start_ts: 10, end_ts: 12, text: '短'.repeat(8), confidence: 0.8 },
    ];
    const chunks = chunkTranscript(segs);
    expect(chunks).toHaveLength(1); // 短尾巴并进超长那片
    expect(chunks[0]!.text.length).toBe(708);
    expect(chunks[0]!.notes.some((n) => n.includes('单段超长'))).toBe(true);
  });

  it('够了下限后优先在句末收片（次级边界）', () => {
    const segs = makeSegments(60, 10, false);
    // 第 32 段（下标 31）是句末，其余不是 —— 应在 321 字处切，而不是 300
    segs[31]!.text = segs[31]!.text.trim() + SENTENCE_END;
    const chunks = chunkTranscript(segs);
    expect(chunks[0]!.text.length).toBe(321);
    expect(chunks[0]!.last_segment).toBe(31);
  });

  it('自定义参数生效（下限 50 / 上限 100 / 重叠 0）', () => {
    const opts: ChunkOptions = { minChars: 50, maxChars: 100, overlapRatio: 0 };
    const chunks = chunkTranscript(makeSegments(20), opts);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]!.overlap_chars).toBe(0);
  });
});

describe('endsSentence', () => {
  it('只认句末标点，不认逗号', () => {
    expect(endsSentence('就是这样。')).toBe(true);
    expect(endsSentence('就是这样！')).toBe(true);
    expect(endsSentence('就是这样，')).toBe(false);
    expect(endsSentence('就是这样')).toBe(false);
  });
});