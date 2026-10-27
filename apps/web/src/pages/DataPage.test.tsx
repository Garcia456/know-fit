import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem, SessionDetail } from '../api/types';
import { DataPage } from './DataPage';

function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const today = new Date();
const todayKey = key(today);
const prev = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
const prevKey = key(prev);

const items: HistoryItem[] = [
  {
    session_id: 's-today',
    date: todayKey,
    split_label: '腿日',
    status: 'complete',
    missing_fields: [],
    exercise_count: 1,
    working_sets: 3,
    volume_kg: 3000,
    exercise_names: ['深蹲'],
  },
  {
    session_id: 's-prev',
    date: prevKey,
    split_label: '背日',
    status: 'incomplete',
    missing_fields: ['reps'],
    exercise_count: 2,
    working_sets: 6,
    volume_kg: 1200,
    exercise_names: ['引体向上', '划船'],
  },
];

function detail(id: string, date: string, split: string): SessionDetail {
  return {
    session_id: id,
    date,
    split_label: split,
    status: 'incomplete',
    missing_fields: ['reps'],
    note: null,
    exercises: [
      {
        raw_name: '引体向上',
        exercise_id: null,
        name_zh: null,
        region_fallback: 'region_back',
        name_confidence: 'low',
        sets: [{ weight_kg: 70, reps: null, set_type: 'working', is_inferred: false }],
      },
    ],
    volume: {
      session_id: id,
      total_volume_kg: 0,
      working_sets: 0,
      warmup_sets: 0,
      skipped_sets: 1,
      inferred_sets: 0,
      by_muscle: {},
      unrecognized_exercises: 0,
    },
    hook: {
      metric: 'volume',
      scope: { split_label: split },
      current: 0,
      baseline: null,
      delta_pct: null,
      baseline_kind: 'prev_same_split',
    },
  };
}

const details: Record<string, SessionDetail> = {
  's-today': detail('s-today', todayKey, '腿日'),
  's-prev': detail('s-prev', prevKey, '背日'),
};

function stubApi(list: HistoryItem[]) {
  const fetchMock = vi.fn((url: string) => {
    let body: unknown = {};
    if (url.startsWith('/api/history')) body = { items: list };
    else if (url.startsWith('/api/sessions/')) {
      const id = decodeURIComponent(url.slice('/api/sessions/'.length));
      body = details[id] ?? details['s-prev'];
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(path = '/data') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataPage />
    </MemoryRouter>,
  );
}

function recordButtons() {
  return screen
    .getAllByRole('button')
    .filter((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').includes('个动作'));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('历史页', () => {
  it('没有历史时整页空状态', async () => {
    stubApi([]);
    renderPage();
    expect(await screen.findByText('还没有训练记录')).toBeDefined();
    expect(screen.getByRole('link', { name: '去记录' })).toBeDefined();
  });

  it('默认不选日期 → 全部记录，默认倒序，可切正序', async () => {
    stubApi(items);
    renderPage();

    expect(await screen.findByText('全部训练记录')).toBeDefined();
    expect(screen.getByRole('button', { name: '切换排序，当前倒序' })).toBeDefined();
    expect(recordButtons()[0]?.textContent).toContain('腿日');
    expect(recordButtons()[1]?.textContent).toContain('背日');

    fireEvent.click(screen.getByRole('button', { name: '切换排序，当前倒序' }));
    expect(screen.getByRole('button', { name: '切换排序，当前正序' })).toBeDefined();
    expect(recordButtons()[0]?.textContent).toContain('背日');
    expect(recordButtons()[1]?.textContent).toContain('腿日');
  });

  it('点日期只看当天，再点取消回到全部', async () => {
    stubApi(items);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${todayKey}.*有训练`) }));
    expect(screen.getByRole('region', { name: '当天训练' })).toBeDefined();
    expect(await screen.findByText(/还缺：次数/)).toBeDefined();
    expect(await screen.findByText(/第一次记录这个部位，暂无对比/)).toBeDefined();
    expect(recordButtons()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${todayKey}.*有训练`) }));
    expect(screen.getByText('全部训练记录')).toBeDefined();
    expect(recordButtons()).toHaveLength(2);
  });

  it('日历没有翻月按钮，方向键切月', async () => {
    stubApi(items);
    renderPage();

    expect(await screen.findByLabelText('训练日历')).toBeDefined();
    expect(screen.queryByRole('button', { name: '上个月' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下个月' })).toBeNull();

    const calendar = screen.getByLabelText('训练日历');
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    fireEvent.keyDown(calendar, { key: 'ArrowRight' });
    expect(screen.getByText(`${next.getFullYear()} 年 ${next.getMonth() + 1} 月`)).toBeDefined();

    fireEvent.keyDown(calendar, { key: 'ArrowLeft' });
    expect(
      screen.getByText(`${today.getFullYear()} 年 ${today.getMonth() + 1} 月`),
    ).toBeDefined();
  });

  it('?date= 进来会选中该天', async () => {
    stubApi(items);
    renderPage(`/data?date=${prevKey}`);
    expect(await screen.findByRole('region', { name: '当天训练' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: new RegExp(`${prevKey}.*有训练`) }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
  });

  it('历史页不再放容量柱、体重折线、热力图', async () => {
    stubApi(items);
    renderPage();
    expect(await screen.findByText('全部训练记录')).toBeDefined();
    expect(screen.queryByText('训练容量')).toBeNull();
    expect(screen.queryByText('体重趋势')).toBeNull();
    expect(screen.queryByLabelText('正面肌肉训练量')).toBeNull();
  });

  it('读失败时保留日历与列表骨架，给重试', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }),
    );
    renderPage();

    expect(await screen.findByText(/训练记录没读出来/)).toBeDefined();
    expect(screen.getByRole('group', { name: '训练日历' })).toBeDefined();
    expect(screen.getByRole('region', { name: '全部训练记录' })).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
    expect(screen.queryByText('还没有训练记录')).toBeNull();
  });
});