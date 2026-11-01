import { describe, expect, it } from 'vitest';
import { selectWithSourceQuota } from './select.js';

const item = (id: string, source_id: string) => ({ id, source_id });

describe('selectWithSourceQuota', () => {
  it('maxPerSource=0 时按原顺序切片，不重排', () => {
    const ranked = [item('a1', 'A'), item('a2', 'A'), item('b1', 'B')];
    const out = selectWithSourceQuota(ranked, { topN: 2, maxPerSource: 0 });
    expect(out.picked.map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(out.backfilled).toBe(0);
    expect(out.distinctSources).toBe(1);
  });

  it('同一来源超过上限时跳到下一来源', () => {
    const ranked = [
      item('a1', 'A'),
      item('a2', 'A'),
      item('a3', 'A'),
      item('b1', 'B'),
      item('b2', 'B'),
      item('c1', 'C'),
    ];
    const out = selectWithSourceQuota(ranked, { topN: 5, maxPerSource: 2 });
    expect(out.picked.map((x) => x.id)).toEqual(['a1', 'a2', 'b1', 'b2', 'c1']);
    expect(out.backfilled).toBe(0);
    expect(out.distinctSources).toBe(3);
  });

  it('来源不足时按分数回填，条数不变', () => {
    const ranked = [item('a1', 'A'), item('a2', 'A'), item('a3', 'A')];
    const out = selectWithSourceQuota(ranked, { topN: 3, maxPerSource: 1 });
    expect(out.picked.map((x) => x.id)).toEqual(['a1', 'a2', 'a3']);
    expect(out.backfilled).toBe(2);
    expect(out.distinctSources).toBe(1);
  });

  it('取满 topN 即停，不改变分数顺序', () => {
    const ranked = [item('a1', 'A'), item('b1', 'B'), item('c1', 'C'), item('d1', 'D')];
    const out = selectWithSourceQuota(ranked, { topN: 2, maxPerSource: 2 });
    expect(out.picked.map((x) => x.id)).toEqual(['a1', 'b1']);
  });

  it('topN 大于候选数时全取', () => {
    const ranked = [item('a1', 'A'), item('b1', 'B')];
    const out = selectWithSourceQuota(ranked, { topN: 5, maxPerSource: 2 });
    expect(out.picked.map((x) => x.id)).toEqual(['a1', 'b1']);
    expect(out.backfilled).toBe(0);
  });
});