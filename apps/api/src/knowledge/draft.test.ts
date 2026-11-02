import { describe, expect, it } from 'vitest';
import { draftKnowledge, KnowledgeDraftSchema } from './draft.js';
import type { LlmClient } from '../llm/client.js';
import type { AssessmentCandidate } from '../assessment/types.js';
import { buildGateWindows } from '../assessment/windows.js';

/**
 * 知识起草的校验规则 —— 不连库、不联网。
 * 验的是「不合法就不放行」，不是「模型答得好」。
 */

function stubLlm(drafts: unknown[]): { llm: LlmClient; systems: string[] } {
  const systems: string[] = [];
  let i = 0;
  const llm: LlmClient = {
    model: 'stub',
    async structured<T>(req: { system: string; schema: { parse: (v: unknown) => T } }) {
      systems.push(req.system);
      const out = drafts[Math.min(i, drafts.length - 1)];
      i++;
      return req.schema.parse(out);
    },
    async generate() {
      return '';
    },
  };
  return { llm, systems };
}

function candidate(id: string): AssessmentCandidate {
  const text = '练胸先做卧推，再做上斜，每组留两次余力。';
  return {
    chunk_id: `chunk-${id}`,
    source_id: `source-${id}`,
    creator: '博主',
    title: '标题',
    url: 'https://example.com',
    start_ts: 0,
    chunk_text: text,
    windows: buildGateWindows({ chunk_text: text, start_ts: 0, end_ts: 1, segments: null }),
    context_prefix: '',
    similarity: 0.9,
    rerank_score: 0.8,
  };
}

const claim = (source_index: number | null, text = '练胸先做卧推。') => ({
  claim: text,
  source_index,
});

describe('知识起草', () => {
  it('1–3 条且来源不同 → 通过', async () => {
    const { llm } = stubLlm([{ claims: [claim(0), claim(1)] }]);
    const out = await draftKnowledge(llm, '练胸练什么', [candidate('a'), candidate('b')]);

    expect(out.problem).toBeNull();
    expect(out.draft?.claims.map((c) => c.source_index)).toEqual([0, 1]);
  });

  it('没有 source_index → 带修正重试一次', async () => {
    const { llm, systems } = stubLlm([
      { claims: [claim(null)] },
      { claims: [claim(0)] },
    ]);
    const out = await draftKnowledge(llm, '练胸练什么', [candidate('a')]);

    expect(out.problem).toBeNull();
    expect(systems).toHaveLength(2);
    expect(systems[0]).not.toContain('【修正】');
    expect(systems[1]).toContain('【修正】');
  });

  it('两次都越界 → 交出 problem，不放宽', async () => {
    const { llm, systems } = stubLlm([{ claims: [claim(3)] }]);
    const out = await draftKnowledge(llm, '练胸练什么', [candidate('a')]);

    expect(out.draft).toBeNull();
    expect(out.problem).toBe('bad_source_index');
    expect(systems).toHaveLength(2);
  });

  it('超过引用上限（默认 2）只保留前 2 条', async () => {
    const { llm } = stubLlm([
      { claims: [claim(0), claim(1), claim(2)] },
    ]);
    const out = await draftKnowledge(llm, '练胸练什么', [
      candidate('a'),
      candidate('b'),
      candidate('c'),
    ]);

    expect(out.problem).toBeNull();
    expect(out.draft?.claims.map((c) => c.source_index)).toEqual([0, 1]);
  });

  it('空 claim → empty_claim', async () => {
    const { llm } = stubLlm([{ claims: [claim(0, '   ')] }]);
    const out = await draftKnowledge(llm, '练胸练什么', [candidate('a')]);

    expect(out.problem).toBe('empty_claim');
  });

  it('两条指向同一视频 → duplicate_source', async () => {
    const { llm } = stubLlm([{ claims: [claim(0), claim(0)] }]);
    const out = await draftKnowledge(llm, '练胸练什么', [candidate('a')]);

    expect(out.problem).toBe('duplicate_source');
  });

  it('同一视频多片先去重，模型编号能换回候选全集下标', async () => {
    const candidates = [candidate('a'), candidate('b'), candidate('a'), candidate('c')];
    const { llm } = stubLlm([{ claims: [claim(0), claim(2)] }]);
    const out = await draftKnowledge(llm, '练胸练什么', candidates);

    expect(out.problem).toBeNull();
    expect(out.draft?.claims.map((c) => c.source_index)).toEqual([0, 3]);
  });

  it('schema 允许 source_index 为 null（校验层再拦）', () => {
    expect(KnowledgeDraftSchema.parse({ claims: [claim(null)] }).claims[0]?.source_index).toBeNull();
  });
});