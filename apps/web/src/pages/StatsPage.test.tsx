import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatsRange } from '../api/types';
import { startOfMonth, startOfWeekKey } from '../lib/calendar';
import { StatsPage } from './StatsPage';

function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const today = new Date();
const todayKey = key(today);
const prev = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
const prevKey = key(prev);

async function pickDate(label: string, value: string) {
  fireEvent.click(screen.getByLabelText(new RegExp(`^${label}日期`)));
  const [y, m, d] = value.split('-').map(Number);
  fireEvent.click(await screen.findByRole('option', { name: `${y}年` }));
  fireEvent.click(screen.getByRole('option', { name: `${m}月` }));
  fireEvent.click(screen.getByRole('option', { name: `${d}日` }));
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
}

const stats: StatsRange = {
  from: prevKey,
  to: todayKey,
  days: [
    { date: prevKey, total_volume_kg: 800, working_sets: 3, hard_sets: 3 },
    { date: todayKey, total_volume_kg: 1200, working_sets: 2, hard_sets: 2 },
  ],
  total_volume_kg: 2000,
  working_sets: 5,
  hard_sets: 5,
  by_muscle_sets: { chest: 5 },
  by_group_sets: { chest: 5 },
  muscle_groups: [],
  unclassified: {
    hard_sets: 0,
    by_region: {},
    region_labels: {},
    unrecognized_hard_sets: 0,
    exercises: [],
  },
  previous: { from: '2026-01-01', to: '2026-01-02', hard_sets: 4, delta: 1, delta_pct: 25 },
  inferred_hard_sets: 0,
  warmup_sets: 1,
  training_days: 2,
  by_muscle: { chest: 1200, triceps: 600 },
  weight_points: [
    { date: prevKey, weight_kg: 81 },
    { date: todayKey, weight_kg: 80 },
  ],
  weight_latest: { date: todayKey, weight_kg: 80 },
  weight_delta_kg: -1,
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

function renderPage(entry = '/stats') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <StatsPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="location">{`${loc.pathname}${loc.search}`}</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('统计页', () => {
  it('默认本周：按周一到今天请求，卡片只显示总有效组数', async () => {
    const urls = stubStats();
    renderPage();

    expect(await screen.findByText('训练容量')).toBeDefined();
    expect(screen.getByRole('button', { name: '本周' }).getAttribute('aria-pressed')).toBe('true');
    expect(urls[0]).toBe(`/api/stats?from=${startOfWeekKey(today)}&to=${todayKey}`);

    // 主卡片只有一个数：不再显示吨位
    expect(screen.getByRole('link', { name: /总有效组数 5 组/ })).toBeDefined();
    expect(screen.queryByText('2,000')).toBeNull();
    expect(screen.getByText('2 天有训练 · 5 组有效')).toBeDefined();
    expect(screen.queryByRole('img', { name: /每日训练容量/ })).toBeNull();
  });

  it('点卡片进二级页，区间带在 URL 上', async () => {
    stubStats();
    renderPage();
    await screen.findByText('训练容量');

    const link = screen.getByRole('link', { name: /查看肌群分布/ });
    expect(link.getAttribute('href')).toBe(`/stats/hard-sets?from=${prevKey}&to=${todayKey}`);
  });

  it('从 URL 恢复区间：刷新 / 二级页返回不丢范围', async () => {
    const urls = stubStats();
    renderPage('/stats?from=2026-01-05&to=2026-01-31');

    await screen.findByText('训练容量');
    expect(screen.getByRole('button', { name: '自定义' }).getAttribute('aria-pressed')).toBe('true');
    expect(urls[0]).toBe('/api/stats?from=2026-01-05&to=2026-01-31');
    expect(screen.getByTestId('location').textContent).toBe('/stats?from=2026-01-05&to=2026-01-31');
  });

  it('今天 / 本月切换后按新范围请求', async () => {
    const urls = stubStats();
    renderPage();
    await screen.findByText('训练容量');

    fireEvent.click(screen.getByRole('button', { name: '今天' }));
    await waitFor(() =>
      expect(urls.at(-1)).toBe(`/api/stats?from=${todayKey}&to=${todayKey}`),
    );

    fireEvent.click(screen.getByRole('button', { name: '本月' }));
    await waitFor(() =>
      expect(urls.at(-1)).toBe(
        `/api/stats?from=${key(startOfMonth(today))}&to=${todayKey}`,
      ),
    );
  });

  it('自定义起止日期；开始晚于结束时报错且不请求', async () => {
    const urls = stubStats();
    renderPage();
    await screen.findByText('训练容量');

    fireEvent.click(screen.getByRole('button', { name: '自定义' }));
    const from = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 10));
    await pickDate('开始', from);
    await pickDate('结束', todayKey);
    await waitFor(() =>
      expect(urls.at(-1)).toBe(`/api/stats?from=${from}&to=${todayKey}`),
    );

    const mid = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
    await pickDate('结束', mid);
    await waitFor(() => expect(urls.at(-1)).toBe(`/api/stats?from=${from}&to=${mid}`));

    const before = urls.length;
    await pickDate('开始', todayKey);
    expect(await screen.findByText('开始日期不能晚于结束日期')).toBeDefined();
    expect(urls.length).toBe(before);
  });

  it('空范围不画 0 值图，也不出热力图', async () => {
    stubStats({
      ...stats,
      days: [],
      total_volume_kg: 0,
      working_sets: 0,
      hard_sets: 0,
      by_muscle_sets: {},
      by_group_sets: {},
      training_days: 0,
      by_muscle: {},
      weight_points: [],
      weight_latest: null,
      weight_delta_kg: null,
    });
    renderPage();

    expect(await screen.findByText('这个范围还没有训练记录。')).toBeDefined();
    expect(screen.queryByRole('img', { name: /每日训练容量/ })).toBeNull();
    expect(screen.getByText('这个范围还没有体重记录 —— 在「我的」填一次')).toBeDefined();
    expect(screen.queryByLabelText('肌肉热力图')).toBeNull();
  });

  it('体重点不足两个时不画折线', async () => {
    stubStats({
      ...stats,
      weight_points: [{ date: todayKey, weight_kg: 80 }],
      weight_latest: { date: todayKey, weight_kg: 80 },
      weight_delta_kg: null,
    });
    renderPage();

    expect(await screen.findByText('记两次体重后才出趋势')).toBeDefined();
    expect(screen.queryByRole('img', { name: /体重折线/ })).toBeNull();
  });

  it('体重点够了画折线，并显示范围内差值', async () => {
    stubStats();
    renderPage();

    expect(await screen.findByRole('img', { name: /体重折线：.*80 千克/ })).toBeDefined();
    expect(screen.getByText('▼ 1 kg')).toBeDefined();
  });

  it('热力图跟随整个范围聚合，无图例与清单', async () => {
    const { container } = stubStatsAndRender();
    expect(await screen.findByLabelText('肌肉热力图')).toBeDefined();
    expect(container.querySelector('[data-region="chest"]')?.getAttribute('class')).toContain(
      'heat-4',
    );
    expect(container.querySelector('[data-region="biceps"]')?.getAttribute('class')).toContain(
      'heat-0',
    );
    expect(screen.queryByLabelText('颜色图例')).toBeNull();
    expect(screen.queryByText('没练到')).toBeNull();
    expect(screen.queryByLabelText('肌群训练量清单')).toBeNull();
  });

  it('读失败时版块还在，给重试', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }),
    );
    renderPage();

    expect(await screen.findByText(/统计没读出来/)).toBeDefined();
    expect(screen.getByRole('region', { name: '训练容量' })).toBeDefined();
    expect(screen.getByRole('region', { name: '体重趋势' })).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });
});

function stubStatsAndRender() {
  stubStats();
  return renderPage();
}