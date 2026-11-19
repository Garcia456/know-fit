import { describe, expect, it } from 'vitest';
import { createUsageRecorder, llmEntry, summarizeUsage, type UsageEntry } from './usage.js';

/**
 * 用量打点 —— 只回答「调了几次、烧了多少 token」，不算钱。
 * 🔴 缺数记 null，不记 0。
 */

const e = (over: Partial<UsageEntry> = {}): UsageEntry => ({
  stage: 'llm',
  label: 'intent',
  model: 'm',
  input_tokens: 100,
  output_tokens: 10,
  ...over,
});

describe('createUsageRecorder', () => {
  it('按调用顺序记，snapshot 给的是副本', () => {
    const recorder = createUsageRecorder();
    recorder.record(e());
    recorder.record(e({ stage: 'embedding', label: 'query', output_tokens: null }));

    const snap = recorder.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.map((x) => x.stage)).toEqual(['llm', 'embedding']);

    snap[0]!.input_tokens = 999;
    expect(recorder.snapshot()[0]!.input_tokens).toBe(100);
  });
});

describe('llmEntry', () => {
  it('usage_metadata 有数就照搬', () => {
    const out = llmEntry({ label: 'intent', model: 'qwen', usage_metadata: { input_tokens: 671, output_tokens: 12 } });
    expect(out).toEqual({ stage: 'llm', label: 'intent', model: 'qwen', input_tokens: 671, output_tokens: 12 });
  });

  it('没回 usage 记 null —— 不伪装成 0', () => {
    const out = llmEntry({ label: 'intent', model: 'qwen', usage_metadata: null });
    expect(out.input_tokens).toBeNull();
    expect(out.output_tokens).toBeNull();
  });

  it('只回了一个数，另一个仍是 null', () => {
    const out = llmEntry({ label: 'intent', model: 'qwen', usage_metadata: { input_tokens: 30 } });
    expect(out.input_tokens).toBe(30);
    expect(out.output_tokens).toBeNull();
  });
});

describe('summarizeUsage', () => {
  it('按 stage 计数并求和', () => {
    const out = summarizeUsage([
      e(),
      e({ label: 'draft_knowledge', input_tokens: 2500, output_tokens: 150 }),
      e({ stage: 'embedding', label: 'query', input_tokens: 8, output_tokens: null }),
    ]);
    expect(out.calls).toEqual({ llm: 2, embedding: 1, rerank: 0 });
    expect(out.input_tokens).toBe(2608);
    expect(out.output_tokens).toBe(160);
    expect(out.incomplete).toBe(true); // embedding 没有 output 口径
  });

  it('一条都没回数 → 合计是 null，不是 0', () => {
    const out = summarizeUsage([e({ input_tokens: null, output_tokens: null })]);
    expect(out.input_tokens).toBeNull();
    expect(out.output_tokens).toBeNull();
    expect(out.incomplete).toBe(true);
  });

  it('空列表 → 全 0 且不算残缺', () => {
    expect(summarizeUsage([])).toEqual({
      calls: { llm: 0, embedding: 0, rerank: 0 },
      input_tokens: null,
      output_tokens: null,
      incomplete: false,
    });
  });

  it('全部齐 → incomplete=false', () => {
    const out = summarizeUsage([e(), e({ label: 'verify_citation', input_tokens: 700, output_tokens: 90 })]);
    expect(out.incomplete).toBe(false);
    expect(out.input_tokens).toBe(800);
  });
});
