import { describe, expect, it } from 'vitest';
import { draftAdvice } from './draft.js';
import type { LlmClient } from '../llm/client.js';
import { buildVolumeHook } from '../metrics/hook.js';
import type { AssessmentCandidate } from './types.js';
import { buildGateWindows } from './windows.js';

/** 按调用顺序吐草稿的桩 —— 每次调用取一条，用完重复最后一条 */
function stubLlm(drafts: unknown[]): { llm: LlmClient; systems: string[] } {
  const systems: string[] = [];
  let i = 0;
  const llm: LlmClient = {
    model: 'stub',
    async structured<T>(req: { system: string }) {
      systems.push(req.system);
      const out = drafts[Math.min(i, drafts.length - 1)];
      i++;
      return out as T;
    },
    async generate() {
      return '';
    },
  };
  return { llm, systems };
}

const VERDICT = buildVolumeHook({ current: 2000, baseline: 2500, split_label: '推日' });

const candidate = (id: string): AssessmentCandidate => ({
  chunk_id: `chunk-${id}`,
  source_id: `source-${id}`,
  creator: '博主',
  title: '标题',
  url: 'https://example.com',
  start_ts: 0,
  chunk_text: '一段足够长的原话，用来当候选片段。',
  windows: buildGateWindows({
    chunk_text: '一段足够长的原话，用来当候选片段。',
    start_ts: 0,
    end_ts: 1,
    segments: null,
  }),
  context_prefix: '',
  similarity: 0.9,
  rerank_score: 0.8,
});

const personal = { claim: '推日容量下降到 2000。', basis: 'personal_data' as const, source_index: null };
const source = (i: number) => ({ claim: '建议保留余量。', basis: 'source' as const, source_index: i });

describe('起草重试', () => {
  it('第一次漏了 personal claim → 带修正要求重试一次', async () => {
    const { llm, systems } = stubLlm([
      { claims: [source(0), source(1)] },
      { claims: [personal, source(0)] },
    ]);
    const out = await draftAdvice(llm, VERDICT, [candidate('a'), candidate('b')]);

    expect(out.problem).toBeNull();
    expect(out.draft?.claims).toHaveLength(2);
    expect(systems).toHaveLength(2);
    expect(systems[0]).not.toContain('【修正】');
    expect(systems[1]).toContain('【修正】');
  });

  it('两次都不合法 → 交回 problem，不放宽规则', async () => {
    const { llm, systems } = stubLlm([{ claims: [source(0), source(1)] }]);
    const out = await draftAdvice(llm, VERDICT, [candidate('a'), candidate('b')]);

    expect(out.draft).toBeNull();
    expect(out.problem).toBe('no_personal');
    expect(systems).toHaveLength(2);
  });

  it('两条 source claim 指向同一个视频 → 被 duplicate_source 拦下', async () => {
    const { llm } = stubLlm([{ claims: [personal, source(0), source(0)] }]);
    const out = await draftAdvice(llm, VERDICT, [candidate('a'), candidate('b')]);

    expect(out.draft).toBeNull();
    expect(out.problem).toBe('duplicate_source');
  });

  it('候选里的同一视频去重后，编号换回全集下标', async () => {
    // 候选 0 与 2 同源；模型看到的是去重后的 0/1/2 → 应该映射回 0/1/3
    const candidates = [candidate('a'), candidate('b'), candidate('a'), candidate('c')];
    const { llm } = stubLlm([{ claims: [personal, source(2)] }]);
    const out = await draftAdvice(llm, VERDICT, candidates);

    expect(out.problem).toBeNull();
    const idx = out.draft!.claims[1]!.source_index;
    expect(idx).toBe(3);
    expect(candidates[idx!]!.source_id).toBe('source-c');
  });
});