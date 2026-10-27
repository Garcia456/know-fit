import { describe, expect, it } from 'vitest';
import type { AdviceClaim, Citation } from '../api/types';
import { numberClaims } from './citations';

const citations: Citation[] = [
  {
    citation_id: 'c-2',
    creator: '甲',
    title: '视频二',
    url: 'https://example.com/2',
    start_ts: 10,
    short_quote: '第二句',
  },
  {
    citation_id: 'c-1',
    creator: '乙',
    title: '视频一',
    url: 'https://example.com/1',
    start_ts: 20,
    short_quote: '第一句',
  },
];

describe('claim → citation 编号', () => {
  it('按引用列表顺序编号，personal_data 不带编号', () => {
    const claims: AdviceClaim[] = [
      { claim: '你的容量上升', basis: 'personal_data', citation_id: null },
      { claim: '注意控制', basis: 'source', citation_id: 'c-1' },
      { claim: '渐进超负荷', basis: 'source', citation_id: 'c-2' },
    ];

    expect(numberClaims(claims, citations)).toEqual([
      { claim: '你的容量上升', basis: 'personal_data', number: null },
      { claim: '注意控制', basis: 'source', number: 2 },
      { claim: '渐进超负荷', basis: 'source', number: 1 },
    ]);
  });

  it('citation_id 对不上时不硬凑编号', () => {
    const claims: AdviceClaim[] = [
      { claim: '找不到的引用', basis: 'source', citation_id: 'missing' },
    ];
    expect(numberClaims(claims, citations)[0]?.number).toBeNull();
  });
});