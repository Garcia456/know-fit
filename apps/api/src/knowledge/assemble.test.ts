import { describe, expect, it } from 'vitest';
import { assembleKnowledge } from './assemble.js';
import type { AssessmentCandidate } from '../assessment/types.js';
import { buildGateWindows } from '../assessment/windows.js';

/**
 * 知识卡的装配 —— 逐条保留 + 每条视频只出现一次（ADR-068）。
 * 验的是不变量，不是模型答得好不好。
 */

const TEXT = '练胸先做复合动作，再做上斜哑铃卧推，全程沉肩，下放到胸口再推起。';

function candidate(id: string, overrides: Partial<AssessmentCandidate> = {}): AssessmentCandidate {
  return {
    chunk_id: `chunk-${id}`,
    source_id: `source-${id}`,
    creator: `博主${id}`,
    title: `标题${id}`,
    url: `https://example.com/${id}`,
    start_ts: 0,
    chunk_text: TEXT,
    windows: buildGateWindows({ chunk_text: TEXT, start_ts: 0, end_ts: 1, segments: null }),
    context_prefix: '',
    similarity: 0.9,
    rerank_score: 0.8,
    ...overrides,
  };
}

const ok = { supported: true, quote: TEXT.slice(0, 12), quote_start: 0, quote_end: 12 };
const no = { supported: false, quote: '', quote_start: null, quote_end: null };

let seq = 0;
const newId = () => `cit-${++seq}`;

describe('assembleKnowledge', () => {
  it('部分不过闸② → 只丢自己，其余照常保留', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const out = assembleKnowledge({
      claims: [
        { claim: '先做复合动作', source_index: 0 },
        { claim: '再做上斜卧推', source_index: 1 },
        { claim: '全程沉肩', source_index: 2 },
      ],
      checks: [ok, no, ok],
      candidates,
      maxCitations: 3,
      newId,
    });
    expect(out?.knowledgeClaims.map((c) => c.claim)).toEqual(['先做复合动作', '全程沉肩']);
    expect(out?.citations.map((c) => c.creator)).toEqual(['博主a', '博主c']);
  });

  it('同一来源第二次出现 → 丢弃，链接两两不同', () => {
    const candidates = [candidate('a'), candidate('b')];
    const out = assembleKnowledge({
      claims: [
        { claim: '第一条', source_index: 0 },
        { claim: '第二条（同源）', source_index: 0 },
        { claim: '第三条', source_index: 1 },
      ],
      checks: [ok, ok, ok],
      candidates,
      maxCitations: 3,
      newId,
    });
    expect(out?.knowledgeClaims.map((c) => c.claim)).toEqual(['第一条', '第三条']);
    expect(out?.citations).toHaveLength(2);
    expect(new Set(out?.citations.map((c) => c.url)).size).toBe(2);
  });

  it('不同 source_id 但同一链接 → 也只留第一次（防重行来源）', () => {
    const candidates = [candidate('a'), candidate('b', { url: 'https://example.com/a' })];
    const out = assembleKnowledge({
      claims: [
        { claim: '第一条', source_index: 0 },
        { claim: '第二条', source_index: 1 },
      ],
      checks: [ok, ok],
      candidates,
      maxCitations: 3,
      newId,
    });
    expect(out?.knowledgeClaims).toHaveLength(1);
    expect(out?.citations[0]?.url).toBe('https://example.com/a');
  });

  it('claims 与 citations 一一对应，citation_id 不重复', () => {
    const candidates = [candidate('a'), candidate('b')];
    const out = assembleKnowledge({
      claims: [
        { claim: '第一条', source_index: 0 },
        { claim: '第二条', source_index: 1 },
      ],
      checks: [ok, ok],
      candidates,
      maxCitations: 3,
      newId,
    });
    expect(out?.citations).toHaveLength(out!.knowledgeClaims.length);
    expect(out?.knowledgeClaims.every((c, i) => c.citation_id === out!.citations[i]?.citation_id)).toBe(true);
    expect(new Set(out?.citations.map((c) => c.citation_id)).size).toBe(2);
  });

  it('全部不过闸② / 编号失效 → null（调用方降级无源）', () => {
    const candidates = [candidate('a')];
    expect(
      assembleKnowledge({
        claims: [{ claim: '不过', source_index: 0 }],
        checks: [no],
        candidates,
        maxCitations: 3,
        newId,
      }),
    ).toBeNull();
    expect(
      assembleKnowledge({
        claims: [{ claim: '编号没了', source_index: null }],
        checks: [ok],
        candidates,
        maxCitations: 3,
        newId,
      }),
    ).toBeNull();
    expect(
      assembleKnowledge({
        claims: [{ claim: '越界', source_index: 9 }],
        checks: [ok],
        candidates,
        maxCitations: 3,
        newId,
      }),
    ).toBeNull();
  });

  it('超过上限 → 截到上限，不是整卡失败', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const out = assembleKnowledge({
      claims: [
        { claim: '第一条', source_index: 0 },
        { claim: '第二条', source_index: 1 },
        { claim: '第三条', source_index: 2 },
      ],
      checks: [ok, ok, ok],
      candidates,
      maxCitations: 2,
      newId,
    });
    expect(out?.knowledgeClaims.map((c) => c.claim)).toEqual(['第一条', '第二条']);
  });

  it('上限夹在 1–3（配置写 5 也只出 3 条）', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const all = [0, 1, 2].map((i) => ({ claim: `第${i}条`, source_index: i }));
    for (const maxCitations of [0, 5]) {
      seq = 0;
      const out = assembleKnowledge({
        claims: all,
        checks: [ok, ok, ok],
        candidates,
        maxCitations,
        newId,
      });
      expect(out?.knowledgeClaims).toHaveLength(maxCitations === 0 ? 1 : 3);
    }
  });

  it('claim 文本 trim 后进入卡片', () => {
    const out = assembleKnowledge({
      claims: [{ claim: '  先做复合动作  ', source_index: 0 }],
      checks: [ok],
      candidates: [candidate('a')],
      maxCitations: 3,
      newId,
    });
    expect(out?.knowledgeClaims[0]?.claim).toBe('先做复合动作');
  });
});
