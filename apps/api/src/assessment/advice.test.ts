import { describe, expect, it } from 'vitest';
import {
  assembleCitations,
  renderAdvice,
  sanitizeNoSourceAdvice,
  toAdviceClaims,
  validateDraft,
  type Draft,
} from './advice.js';
import type { AssessmentCandidate } from './types.js';
import { buildVolumeHook } from '../metrics/hook.js';

const VERDICT = buildVolumeHook({ current: 2000, baseline: 2500, split_label: '推日' });

function candidate(id: string, sourceId: string): AssessmentCandidate {
  return {
    chunk_id: id,
    source_id: sourceId,
    creator: `博主${sourceId}`,
    title: '标题',
    url: `https://www.douyin.com/video/${sourceId}`,
    start_ts: 10,
    chunk_text: `片段 ${id} 的正文，足够长到能当引用。`,
    context_prefix: '[测试]',
    similarity: 0.9,
    rerank_score: 0.8,
  };
}

const draft = (claims: Draft['claims']): Draft => ({ claims });

const PERSONAL = { claim: '这次 2000kg', basis: 'personal_data' as const, source_index: null };
const sourceClaim = (index: number) => ({ claim: `建议${index}`, basis: 'source' as const, source_index: index });

function check(index: number, ok = true) {
  return {
    claim_id: `C${index}`,
    supported: ok,
    quote_start: ok ? 0 : null,
    quote_end: ok ? 12 : null,
  };
}

describe('validateDraft', () => {
  const candidates = [candidate('k0', 's1'), candidate('k1', 's2')];

  it('1 条 personal + 1 条 source → 通过', () => {
    expect(validateDraft(draft([PERSONAL, sourceClaim(0)]), candidates)).toBeNull();
  });

  it('claim 少于 2 条 / 多于 4 条 → 拒', () => {
    expect(validateDraft(draft([PERSONAL]), candidates)).toBe('claim_count');
    expect(
      validateDraft(
        draft([PERSONAL, sourceClaim(0), sourceClaim(1), { ...PERSONAL }, { ...PERSONAL }]),
        candidates,
      ),
    ).toBe('claim_count');
  });

  it('必须有 personal_data，且它不能带 source_index', () => {
    expect(validateDraft(draft([sourceClaim(0), sourceClaim(1)]), candidates)).toBe('no_personal');
    expect(
      validateDraft(draft([{ ...PERSONAL, source_index: 0 }, sourceClaim(1)]), candidates),
    ).toBe('personal_has_source');
  });

  it('source claim 必须 1–2 条', () => {
    expect(validateDraft(draft([PERSONAL, { ...PERSONAL }]), candidates)).toBe('source_count');
    expect(
      validateDraft(draft([PERSONAL, sourceClaim(0), sourceClaim(1)]), candidates),
    ).toBeNull();
  });

  it('source_index 越界 / 空 → bad_source_index', () => {
    expect(validateDraft(draft([PERSONAL, sourceClaim(2)]), candidates)).toBe('bad_source_index');
    expect(
      validateDraft(draft([PERSONAL, { claim: 'x', basis: 'source', source_index: null }]), candidates),
    ).toBe('bad_source_index');
  });

  it('两条 source 指向同一条视频 → duplicate_source', () => {
    const same = [candidate('k0', 's1'), candidate('k1', 's1')];
    expect(validateDraft(draft([PERSONAL, sourceClaim(0), sourceClaim(1)]), same)).toBe('duplicate_source');
  });

  it('空 claim → empty_claim', () => {
    expect(validateDraft(draft([PERSONAL, { claim: '  ', basis: 'source', source_index: 0 }]), candidates)).toBe(
      'empty_claim',
    );
  });
});

describe('assembleCitations', () => {
  const candidates = [candidate('k0', 's1'), candidate('k1', 's2')];

  it('全部过闸 → 引用逐条对应 claim', () => {
    const out = assembleCitations({
      draft: draft([PERSONAL, sourceClaim(0)]),
      checks: [check(1)],
      candidates,
      maxCitations: 2,
    });
    expect(out.problem).toBeNull();
    expect(out.plans).toHaveLength(1);
    expect(out.plans[0]?.claim_index).toBe(1);
    expect(out.plans[0]?.candidate.chunk_id).toBe('k0');
  });

  it('任一条没通过闸② → 整条不给引用（problem）', () => {
    const out = assembleCitations({
      draft: draft([PERSONAL, sourceClaim(0)]),
      checks: [check(1, false)],
      candidates,
      maxCitations: 2,
    });
    expect(out.problem).toContain('闸②');
    expect(out.plans).toHaveLength(0);
  });

  it('引用条数超上限 → problem', () => {
    const out = assembleCitations({
      draft: draft([PERSONAL, sourceClaim(0), sourceClaim(1)]),
      checks: [check(1), check(2)],
      candidates,
      maxCitations: 1,
    });
    expect(out.problem).toContain('超过');
  });

  it('同源（防御性）→ problem', () => {
    const out = assembleCitations({
      draft: draft([PERSONAL, sourceClaim(0), sourceClaim(1)]),
      checks: [check(1), check(2)],
      candidates: [candidate('k0', 's1'), candidate('k1', 's1')],
      maxCitations: 2,
    });
    expect(out.problem).toContain('同源');
  });
});

describe('建议的出口措辞', () => {
  it('advice 按 claim 顺序拼，不改写', () => {
    expect(renderAdvice(draft([PERSONAL, sourceClaim(0)]))).toBe('这次 2000kg\n建议0');
  });

  it('只有 source claim 带 citation_id', () => {
    const claims = toAdviceClaims(draft([PERSONAL, sourceClaim(0)]), [null, 'cit-1']);
    expect(claims[0]?.citation_id).toBeNull();
    expect(claims[1]?.citation_id).toBe('cit-1');
  });

  it('无源建议不得暗示来源：命中「博主」就退回模板', () => {
    const safe = sanitizeNoSourceAdvice('这次先稳住节奏，下一轮再考虑加重量。', VERDICT);
    expect(safe).toBe('这次先稳住节奏，下一轮再考虑加重量。');

    const leak = sanitizeNoSourceAdvice('有个博主说容量下降要先稳住。', VERDICT);
    expect(leak).not.toContain('博主');
    expect(leak).toContain('2000kg');
  });

  it('空串也退回模板', () => {
    expect(sanitizeNoSourceAdvice('   ', VERDICT)).toContain('2000kg');
  });
});
