import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatsRange } from '../api/types';
import { startOfWeekKey, toDateKey } from '../lib/calendar';
import { HardSetsPage } from './HardSetsPage';

const stats: StatsRange = {
  from: '2026-11-02',
  to: '2026-11-08',
  days: [{ date: '2026-11-03', total_volume_kg: 3000, working_sets: 8, hard_sets: 8 }],
  total_volume_kg: 3000,
  working_sets: 8,
  hard_sets: 8,
  by_muscle_sets: { chest: 6, lats: 12 },
  by_group_sets: { chest: 6, back: 12 },
  muscle_groups: [
    {
      id: 'chest',
      name_zh: '胸',
      weekly_low: 10,
      weekly_high: 20,
      hard_sets: 6,
      muscles: [
        {
          id: 'chest',
          name_zh: '胸',
          hard_sets: 6,
          sources: [{ exercise_id: 'bench_press', name: '卧推', hard_sets: 6, weighted_sets: 6 }],
        },
      ],
    },
    {
      id: 'back',
      name_zh: '背',
      weekly_low: 10,
      weekly_high: 20,
      hard_sets: 12,
      muscles: [
        {
          id: 'lats',
          name_zh: '背阔',
          hard_sets: 12,
          sources: [{ exercise_id: 'row', name: '划船', hard_sets: 12, weighted_sets: 12 }],
        },
      ],
    },
  ],
  unclassified: {
    hard_sets: 2,
    by_region: { region_arm: 2 },
    region_labels: { region_arm: '手臂' },
    unrecognized_hard_sets: 0,
    exercises: [{ name: '弯举？', hard_sets: 2, region_fallback: 'region_arm' }],
  },
  previous: { from: '2026-10-26', to: '2026-11-01', hard_sets: 6, delta: 2, delta_pct: 33.33 },
  inferred_hard_sets: 1,
  warmup_sets: 2,
  training_days: 1,
  by_muscle: { chest: 3000 },
  weight_points: [],
  weight_latest: null,
  weight_delta_kg: null,
};

function stubStats(body: StatsRange = stats) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }),
  );
  return urls;
}

function renderPage(entry = '/stats/hard-sets?from=2026-11-02&to=2026-11-08') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <HardSetsPage />
    </MemoryRouter>,
  );
}

function addDays(d: Date, days: number): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() + days);
  return c;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('有效组数二级页', () => {
  it('概览：总有效组数、较上期、训练天数与平均值', async () => {
    stubStats();
    renderPage();

    expect(await screen.findByText('有效组')).toBeDefined();
    expect(screen.getByText('较上期 +2 组（+33.3%）')).toBeDefined();
    expect(screen.getByText('训练 1 天 · 平均每次 8 组 · 其中推测 1 组')).toBeDefined();
  });

  it('肌群分布：只展示加权组数，不给参考区间与偏高偏低', async () => {
    stubStats();
    renderPage();

    const chest = await screen.findByRole('button', { name: /^胸/ });
    expect(chest.textContent).toContain('6 组');
    const back = screen.getByRole('button', { name: /^背/ });
    expect(back.textContent).toContain('12 组');
    expect(screen.queryByText(/偏低|适中|偏高/)).toBeNull();
  });

  it('展开某组才显示细分肌群与贡献动作', async () => {
    stubStats();
    renderPage();

    const chest = await screen.findByRole('button', { name: /^胸/ });
    expect(screen.queryByText('卧推')).toBeNull();
    fireEvent.click(chest);
    expect(screen.getByText('卧推')).toBeDefined();
    expect(screen.getByText('6 组 · 加权 6')).toBeDefined();
    expect(chest.getAttribute('aria-expanded')).toBe('true');
  });

  it('未归类按部位汇总并列出动作；为 0 时不显示', async () => {
    stubStats();
    const { unmount } = renderPage();

    expect(await screen.findByText('未归类')).toBeDefined();
    expect(screen.getByText('手臂')).toBeDefined();
    expect(screen.getByText('弯举？')).toBeDefined();
    unmount();

    cleanup();
    stubStats({
      ...stats,
      unclassified: {
        hard_sets: 0,
        by_region: {},
        region_labels: {},
        unrecognized_hard_sets: 0,
        exercises: [],
      },
    });
    renderPage();
    await screen.findByText('有效组');
    expect(screen.queryByText('未归类')).toBeNull();
  });

  it('吨位作为辅助口径单独展示', async () => {
    stubStats();
    renderPage();

    expect(await screen.findByText('吨位（辅助）')).toBeDefined();
    expect(screen.getByText('3,000')).toBeDefined();
    expect(screen.getByText(/不是同一个口径/)).toBeDefined();
  });

  it('空区间：概览归零，分布区给空状态', async () => {
    stubStats({
      ...stats,
      days: [],
      hard_sets: 0,
      total_volume_kg: 0,
      working_sets: 0,
      training_days: 0,
      by_muscle_sets: {},
      by_group_sets: {},
      muscle_groups: [],
      unclassified: {
        hard_sets: 0,
        by_region: {},
        region_labels: {},
        unrecognized_hard_sets: 0,
        exercises: [],
      },
      previous: { ...stats.previous, hard_sets: 0, delta: 0, delta_pct: null },
    });
    renderPage();

    expect(await screen.findByText('这个范围还没有训练记录。')).toBeDefined();
    expect(screen.getByText('上期无记录')).toBeDefined();
  });

  it('参数非法 → 回落本周', async () => {
    const urls = stubStats();
    renderPage('/stats/hard-sets?from=2026-13-01&to=oops');

    expect(await screen.findByText('有效组')).toBeDefined();
    const today = new Date();
    expect(urls[0]).toBe(`/api/stats?from=${startOfWeekKey(today)}&to=${toDateKey(today)}`);
  });

  it('读失败时给重试，版块还在', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }),
    );
    renderPage();

    expect(await screen.findByText(/肌群分布没读出来/)).toBeDefined();
    expect(screen.getByRole('region', { name: '有效组数' })).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('可切换区间预设，并把新区间重新拉一遍', async () => {
    const urls = stubStats();
    renderPage();

    expect(await screen.findByText('有效组')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '近 4 周' }));

    const today = new Date();
    const from = toDateKey(addDays(today, -27));
    const to = toDateKey(today);
    await waitFor(() => {
      expect(urls).toContain(`/api/stats?from=${from}&to=${to}`);
    });
    expect(screen.getByRole('button', { name: '近 4 周' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('可一次展开全部肌群，再全部收起', async () => {
    stubStats();
    renderPage();

    expect(await screen.findByText('有效组')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '全部展开肌群明细' }));

    expect(screen.getByText('卧推')).toBeDefined();
    expect(screen.getByText('划船')).toBeDefined();
    expect(
      screen.getByRole('button', { name: /^胸/ }).getAttribute('aria-expanded'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '全部收起肌群明细' }));
    expect(screen.queryByText('卧推')).toBeNull();
    expect(screen.queryByText('划船')).toBeNull();
  });

  it('未归类按总组数展示占比', async () => {
    stubStats();
    renderPage();

    expect(await screen.findByText(/占 25%/)).toBeDefined();
  });
});
