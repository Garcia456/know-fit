import { describe, expect, it } from 'vitest';
import { normalizeTranscript, parseAsrOutput } from './parse.js';
import type { Transcript } from '../kb/types.js';

/**
 * ASR 归一与解析 —— 纯函数，不碰库、不碰模型。
 *
 * 这两步挡的是**外部工具吐回来的脏数据**：空段、乱序、时间戳反了、输出不是 JSON。
 * 它们都不该悄悄流进知识库。
 */

const seg = (start_ts: number, end_ts: number, text: string, confidence: number | null = null) => ({
  start_ts,
  end_ts,
  text,
  confidence,
});

function transcript(segments: Transcript['segments']): Transcript {
  return { language: 'zh', segments };
}

describe('normalizeTranscript：归一三件事', () => {
  it('丢掉空段 —— 模型在停顿处常吐这种', () => {
    const out = normalizeTranscript(
      transcript([seg(0, 0.4, ''), seg(0.4, 6.2, '肩胛收紧'), seg(6.2, 7, '   ')]),
    );
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.text).toBe('肩胛收紧');
  });

  it('按起点排序 —— 分段未必有序，切片前必须有序', () => {
    const out = normalizeTranscript(
      transcript([seg(6.2, 12.8, '第二句'), seg(0.4, 6.2, '第一句')]),
    );
    expect(out.segments.map((s) => s.text)).toEqual(['第一句', '第二句']);
    expect(out.segments.map((s) => s.start_ts)).toEqual([0.4, 6.2]);
  });

  it('语言原样带过', () => {
    expect(normalizeTranscript(transcript([seg(0, 1, '有内容')])).language).toBe('zh');
  });

  it('🔴 归一后一段不剩就是失败 —— 空知识源比没有更糟', () => {
    expect(() => normalizeTranscript(transcript([seg(0, 0.4, ''), seg(0.4, 1, '  ')]))).toThrow(
      /一段不剩/,
    );
  });

  it('归一也过同音纠错表 —— 两条转写路径都绕不过它', () => {
    const out = normalizeTranscript(transcript([seg(0.4, 6.2, '练保加利亚敦的人越来越多')]));
    expect(out.segments[0]!.text).toBe('练保加利亚蹲的人越来越多');
  });
});

describe('parseAsrOutput：解析外部工具的 stdout', () => {
  it('字段名从 whisper 习惯映射到内部类型，并把把握度算成数', () => {
    const out = parseAsrOutput(
      JSON.stringify({
        language: 'zh',
        segments: [{ start: 0.4, end: 6.2, text: '肩胛收紧', confidence: 0.91 }],
      }),
    );
    expect(out).toMatchObject({ language: 'zh' });
    expect(out.segments[0]).toEqual({
      start_ts: 0.4,
      end_ts: 6.2,
      text: '肩胛收紧',
      confidence: 0.91,
    });
  });

  it('拿不到把握度就是 null —— 不编一个数', () => {
    const out = parseAsrOutput(
      JSON.stringify({ language: null, segments: [{ start: 0, end: 1, text: '有内容' }] }),
    );
    expect(out.segments[0]!.confidence).toBeNull();
    expect(out.language).toBeNull();
  });

  it('越界的把握度截到 [0,1] —— 别让它把整条记录带崩', () => {
    const out = parseAsrOutput(
      JSON.stringify({
        segments: [
          { start: 0, end: 1, text: '甲', confidence: 1.4 },
          { start: 1, end: 2, text: '乙', confidence: -0.2 },
        ],
      }),
    );
    expect(out.segments[0]!.confidence).toBe(1);
    expect(out.segments[1]!.confidence).toBe(0);
  });

  it('时间戳反了的段直接抛 —— 坏的段不往下游传', () => {
    expect(() =>
      parseAsrOutput(JSON.stringify({ segments: [{ start: 6, end: 2, text: '坏的' }] })),
    ).toThrow(/时间戳是反的/);
  });

  it('缺时间戳的段直接抛', () => {
    expect(() => parseAsrOutput(JSON.stringify({ segments: [{ text: '没时间戳' }] }))).toThrow(
      /没有可用的时间戳/,
    );
  });

  it('输出不是 JSON 时，报错里带上原文开头 —— 否则这类错无法从现场定位', () => {
    expect(() => parseAsrOutput('Traceback (most recent call last):')).toThrow(
      /Traceback \(most recent call last\)/,
    );
  });

  it('没有 segments 数组时抛 —— 说明与 asr_transcribe.py 的约定被改了', () => {
    expect(() => parseAsrOutput(JSON.stringify({ language: 'zh' }))).toThrow(/没有 segments/);
  });

  it('解析结果同样过归一 —— 空段在这里就被丢掉', () => {
    const out = parseAsrOutput(
      JSON.stringify({
        segments: [
          { start: 0, end: 0.4, text: '' },
          { start: 0.4, end: 6.2, text: '肩胛收紧' },
        ],
      }),
    );
    expect(out.segments).toHaveLength(1);
  });
});