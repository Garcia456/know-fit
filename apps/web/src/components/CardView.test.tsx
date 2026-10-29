import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssessmentCard, CorrectionCard, TurnCard } from '../api/types';
import { AssessmentCardView } from './AssessmentCardView';
import { CardView } from './CardView';
import { LowDataCard } from './LowDataCard';

afterEach(cleanup);

const hook = {
  metric: 'volume' as const,
  scope: { split_label: '背日' },
  current: 3600,
  baseline: null as number | null,
  delta_pct: null as number | null,
  baseline_kind: 'prev_same_split' as const,
};

const workout: TurnCard = {
  kind: 'workout',
  session_id: 's-1',
  date: '2026-10-26',
  split_label: '背日',
  status: 'incomplete',
  missing_fields: ['reps'],
  exercises: [
    {
      raw_name: '引体向上',
      exercise_id: null,
      name_zh: '引体向上',
      region_fallback: null,
      name_confidence: 'high',
      sets: [{ weight_kg: 0, reps: null, set_type: 'working', is_inferred: true }],
      volume_kg: 0,
      working_sets: 1,
    },
  ],
  volume_kg: 0,
  working_sets: 1,
  note: null,
  hook,
};

describe('训练 / 饮食 / 闲聊 / 拒答卡片', () => {
  it('workout：信息不全、缺什么、合计与数据钩子', () => {
    render(
      <CardView card={workout} onAssess={() => undefined} onComplete={() => undefined} />,
    );
    expect(screen.getByText('训练已记录')).toBeDefined();
    expect(screen.getByText('信息不全')).toBeDefined();
    expect(screen.getByText(/还缺：次数/)).toBeDefined();
    expect(screen.getByText(/第一次记录这个部位，暂无对比/)).toBeDefined();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole('button', { name: '补充漏掉的组' })).toBeDefined();
  });

  it('workout：招式缺值不补 0，重量显示待补', () => {
    render(<CardView card={workout} />);
    expect(screen.getByText(/次数待补/)).toBeDefined();
    expect(screen.getByText('0 kg')).toBeDefined();
  });

  it('meal：统计行全是破折号，不编热量', () => {
    render(
      <CardView
        card={{
          kind: 'meal',
          meal_type: 'lunch',
          items: [
            {
              raw_desc: '一碗米饭',
              qty: 1,
              unit: '碗',
              qty_confidence: 'high',
              estimation_basis: '常见碗型',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('午餐已记下')).toBeDefined();
    expect(screen.getByText('份量按估算')).toBeDefined();
    expect(screen.getByText(/仅展示，未入库/)).toBeDefined();
    expect(screen.getByText('kcal 合计')).toBeDefined();
    expect(screen.queryByText(/\d+\s*kcal/)).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('chat / refusal / boundary 原样显示后端文案', () => {
    const { unmount } = render(<CardView card={{ kind: 'chat', reply: '今天休息也很好。' }} />);
    expect(screen.getByText('今天休息也很好。')).toBeDefined();
    unmount();

    render(<CardView card={{ kind: 'refusal', reply: '这条超出范围。', reason: 'medical' }} />);
    expect(screen.getByText('这条超出范围。')).toBeDefined();
    expect(screen.getByLabelText('拒答')).toBeDefined();
    expect(screen.getByText(/不会记进训练记录/)).toBeDefined();
  });

  it('boundary 有独立出口样式', () => {
    render(<CardView card={{ kind: 'boundary', reply: '建议先咨询专业人士。' }} />);
    expect(screen.getByLabelText('使用范围提示')).toBeDefined();
  });

  it('correction：旧值划线、新值与重算合计', () => {
    const card: CorrectionCard = {
      kind: 'correction',
      session_id: 's-1',
      date: '2026-10-26',
      split_label: '推日',
      exercise_index: 0,
      old_weight_kg: 70,
      new_weight_kg: 75,
      corrected_sets: 4,
      exercises: [
        {
          raw_name: '卧推',
          exercise_id: null,
          name_zh: '卧推',
          region_fallback: null,
          name_confidence: 'high',
          sets: [
            { weight_kg: 75, reps: 8, set_type: 'working', is_inferred: false },
            { weight_kg: 75, reps: 8, set_type: 'working', is_inferred: false },
            { weight_kg: 75, reps: 8, set_type: 'working', is_inferred: false },
            { weight_kg: 75, reps: 8, set_type: 'working', is_inferred: false },
          ],
          volume_kg: 2400,
          working_sets: 4,
        },
      ],
      volume_kg: 2400,
      working_sets: 4,
    };
    render(<CardView card={card} />);
    expect(screen.getByText('已更正')).toBeDefined();
    expect(screen.getByText('容量已重算')).toBeDefined();
    expect(screen.getByText('70kg')).toBeDefined();
    expect(screen.getByText(/75kg · 8 次 · 4 组/)).toBeDefined();
    expect(screen.getByText('4 组 · 2,400 kg')).toBeDefined();
  });

  it('knowledge：不显示卡片头；无来源换成斜体 AI 提示', () => {
    render(
      <CardView
        card={{
          kind: 'knowledge',
          answer: '上斜卧推先沉肩。',
          claims: [],
          citations: [],
          has_source: false,
          no_source_notice: '知识库里没有找到可直接支撑的博主原话。',
        }}
      />,
    );
    expect(screen.queryByText('知识回答')).toBeNull();
    expect(screen.queryByText('无来源')).toBeNull();
    const note = screen.getByText('本回答由 AI 生成，内容仅供参考，请仔细甄别。');
    expect(note.className).toContain('is-disclaimer');
  });

  it('数据不足卡：只说缺什么，不给建议', () => {
    render(<LowDataCard missing={['sets', 'baseline']} />);
    expect(screen.getByText('暂时算不出判定')).toBeDefined();
    expect(screen.getByText('数据不足')).toBeDefined();
    expect(screen.getByText('还差 2 项才能算趋势')).toBeDefined();
    expect(screen.getByText('缺数据时我只说明缺什么，不给建议 —— 硬给就是在猜。')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

const baseAssessment: AssessmentCard = {
  kind: 'assessment',
  assessment_id: 'a-1',
  trigger: 'hook',
  verdict: { ...hook, baseline: 3200, delta_pct: 12.5 },
  advice: '这次背部容量比上次高。',
  advice_claims: [
    { claim: '你的背部容量上升 12.5%', basis: 'personal_data', citation_id: null },
    { claim: '背部训练要注意全程控制', basis: 'source', citation_id: 'c-1' },
  ],
  has_source: true,
  citations: [
    {
      citation_id: 'c-1',
      creator: '谭成义',
      title: '背部训练要点',
      url: 'https://example.com/video',
      start_ts: 61,
      short_quote: '全程控制，别甩。',
    },
  ],
  no_source_notice: null,
};

describe('评估卡片的有源 / 无源区分', () => {
  it('有源：标签 + 编号建议 + 博主 / 视频 / 时间戳 / 看原片', () => {
    render(<AssessmentCardView card={baseAssessment} />);
    expect(screen.getByText('有来源')).toBeDefined();
    expect(screen.getByText('谭成义')).toBeDefined();
    expect(screen.getByText('背部训练要点')).toBeDefined();
    expect(screen.getByText('1:01')).toBeDefined();
    const link = screen.getByRole('link', { name: '看原片 1:01' });
    expect(link.getAttribute('href')).toBe('https://example.com/video');
    // 不渲染切片原文
    expect(screen.queryByText('全程控制，别甩。')).toBeNull();
  });

  it('起点不足 1 秒：不显示 0:00 这类时间点', () => {
    render(
      <AssessmentCardView
        card={{
          ...baseAssessment,
          citations: [
            {
              citation_id: 'c-1',
              creator: '谭成义',
              title: '背部训练要点',
              url: 'https://example.com/video',
              start_ts: 0.4,
              short_quote: '全程控制，别甩。',
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText('0:00')).toBeNull();
    expect(screen.getByRole('link', { name: '看原片' })).toBeDefined();
  });

  it('无源：虚线标签 + nosrc 块，无链接', () => {
    render(
      <AssessmentCardView
        card={{
          ...baseAssessment,
          has_source: false,
          citations: [],
          no_source_notice: '知识库里没有找到可直接支撑的博主原话。',
        }}
      />,
    );
    expect(screen.getByText('无来源')).toBeDefined();
    expect(screen.getByText('知识库里没有找到可直接支撑的博主原话。')).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByText(/由 AI 通用知识生成/).length).toBe(2);
  });
});