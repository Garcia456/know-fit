import { describe, expect, it } from 'vitest';
import {
  AdviceClaimSchema,
  AssessmentCardSchema,
  AssessmentRequestSchema,
  CitationSchema,
} from './assessment.js';

/**
 * 对外契约 —— 形状固定，且绝不出现全文型字段名。
 */

const CARD = {
  kind: 'assessment',
  assessment_id: 'a1',
  trigger: 'explicit',
  verdict: {
    metric: 'volume',
    scope: { split_label: '推日' },
    current: 2000,
    baseline: 2500,
    delta_pct: -20,
    baseline_kind: 'prev_same_split',
  },
  advice: '先在 2000kg 上稳住',
  advice_claims: [{ claim: '稳住', basis: 'personal_data', citation_id: null }],
  has_source: false,
  citations: [],
  no_source_notice: '这条没有找到可靠的博主依据',
};

describe('评估卡片契约', () => {
  it('完整卡片能过', () => {
    expect(AssessmentCardSchema.safeParse(CARD).success).toBe(true);
  });

  it('basis 里没有 general —— 通用知识只能走无源路径', () => {
    expect(AdviceClaimSchema.safeParse({ claim: 'x', basis: 'general', citation_id: null }).success).toBe(false);
  });

  it('有源卡必须能带引用句', () => {
    const citation = {
      citation_id: 'c1',
      creator: '博主',
      title: '标题',
      url: 'https://www.douyin.com/video/1',
      start_ts: 12,
      short_quote: '先把容量稳住',
    };
    expect(CitationSchema.safeParse(citation).success).toBe(true);
  });

  it('对外字段里没有全文型字段名', () => {
    for (const shape of [CitationSchema.shape, AssessmentCardSchema.shape]) {
      for (const forbidden of ['text', 'content', 'transcript']) {
        expect(Object.keys(shape)).not.toContain(forbidden);
      }
    }
  });

  it('请求默认 explicit；钩子必须带 uuid', () => {
    expect(AssessmentRequestSchema.parse({}).trigger).toBe('explicit');
    expect(AssessmentRequestSchema.safeParse({ trigger: 'hook' }).success).toBe(true); // 由路由再查空 id
    expect(AssessmentRequestSchema.safeParse({ related_record_id: 'not-a-uuid' }).success).toBe(false);
    expect(AssessmentRequestSchema.parse({ related_record_id: null }).related_record_id).toBeNull();
  });
});
