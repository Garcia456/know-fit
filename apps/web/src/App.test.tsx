import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem, TurnResponse } from './api/types';
import { AppShell } from './App';

/**
 * React 组件测试。
 * 🔴 只断言「状态 → DOM」，不冒充真浏览器里的视觉验收（定义 §0.4 D）。
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

const today = new Date();
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const historyItems: HistoryItem[] = [
  {
    session_id: 's-today',
    date: todayKey,
    split_label: '背日',
    status: 'complete',
    missing_fields: [],
    exercise_count: 3,
    working_sets: 12,
    volume_kg: 2780,
    exercise_names: ['引体向上', '划船'],
  },
];

const chatTurn: TurnResponse = {
  turn_id: 't-1',
  conversation_id: 'c-1',
  intent: 'chat',
  card: { kind: 'chat', reply: '收到，今天先好好休息。' },
  assessment: null,
  assessment_lookup: null,
  notices: [],
};

const sessionDetail = {
  session_id: 's-today',
  date: todayKey,
  split_label: '背日',
  status: 'complete',
  missing_fields: [],
  note: null,
  exercises: [],
  volume: {
    session_id: 's-today',
    total_volume_kg: 2780,
    working_sets: 12,
    warmup_sets: 0,
    skipped_sets: 0,
    inferred_sets: 0,
    by_muscle: {},
    unrecognized_exercises: 0,
  },
  hook: {
    metric: 'volume',
    scope: { split_label: '背日' },
    current: 2780,
    baseline: 3200,
    delta_pct: -13.13,
    baseline_kind: 'prev_same_split',
  },
};

const conversationSummary = {
  id: 'c-1',
  title: '今天休息',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  pinned_at: null,
  last_message: '收到，今天先好好休息。',
};

const conversationDetail = {
  ...conversationSummary,
  messages: [
    {
      id: 'm-1',
      role: 'user',
      content: '今天休息',
      intent: 'chat',
      response: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'm-2',
      role: 'assistant',
      content: '收到，今天先好好休息。',
      intent: 'chat',
      response: chatTurn,
      created_at: new Date().toISOString(),
    },
  ],
};

function stubApi(sessions: unknown[] = []) {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/turns') return json(chatTurn);
    if (url === '/api/nudges/next') return json({ nudge: null });
    if (url === '/api/conversations') return json({ conversations: [conversationSummary] });
    if (url.startsWith('/api/conversations/')) return json(conversationDetail);
    if (url.startsWith('/api/history')) return json({ items: historyItems });
    if (url.startsWith('/api/sessions?')) return json({ sessions });
    if (url.startsWith('/api/sessions/')) return json(sessionDetail);
    if (url.startsWith('/api/metrics/weekly')) {
      return json({ weeks: [], this_week_kg: 0, last_week_kg: 0, delta_pct: null });
    }
    if (url.startsWith('/api/metrics/weight')) {
      return json({ points: [], latest: null, delta_kg: null });
    }
    if (url.startsWith('/api/stats')) {
      return json({
        from: todayKey,
        to: todayKey,
        days: [],
        total_volume_kg: 0,
        working_sets: 0,
        training_days: 0,
        by_muscle: {},
        weight_points: [],
        weight_latest: null,
        weight_delta_kg: null,
      });
    }
    if (url === '/api/profile') {
      return json({
        height_cm: null,
        weight_kg: null,
        weight_date: null,
        goal: null,
        training_years: null,
        training_months: null,
        updated_at: '2026-10-26T00:00:00.000Z',
      });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderShell(path = '/', sessions: unknown[] = []) {
  const fetchMock = stubApi(sessions);
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('顶部导航', () => {
  it('四个 tab 都在，当前页用 aria-current 标出', async () => {
    renderShell('/');
    const nav = screen.getByRole('navigation', { name: '主导航' });
    for (const label of ['会话', '统计', '历史', '我的']) {
      expect(within(nav).getByRole('link', { name: label })).toBeDefined();
    }
    expect(within(nav).getByRole('link', { name: '会话' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).getByRole('link', { name: '历史' }).getAttribute('aria-current')).toBeNull();

    fireEvent.click(within(nav).getByRole('link', { name: '历史' }));
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: '历史' }).getAttribute('aria-current'),
      ).toBe('page'),
    );
    expect(screen.getByRole('link', { name: '会话' }).getAttribute('aria-current')).toBeNull();
    expect(await screen.findByText('全部训练记录')).toBeDefined();

    fireEvent.click(screen.getByRole('link', { name: '统计' }));
    expect(await screen.findByText('训练容量')).toBeDefined();
    expect(screen.getByRole('link', { name: '统计' }).getAttribute('aria-current')).toBe('page');
  });

  it('顶栏与抽屉都有创建新会话入口', () => {
    renderShell('/');
    expect(screen.getByRole('button', { name: '创建新会话' })).toBeDefined();
    expect(screen.getByRole('button', { name: '对话历史' })).toBeDefined();
  });

  it('四页左右滑切换；纵向滑不切页', async () => {
    renderShell('/');
    const host = document.querySelector('.page-swipe');
    expect(host).not.toBeNull();

    function swipe(dx: number, dy = 0) {
      fireEvent.touchStart(host!, { touches: [{ clientX: 200, clientY: 300 }] });
      fireEvent.touchMove(host!, { touches: [{ clientX: 200 + dx / 2, clientY: 300 + dy / 2 }] });
      fireEvent.touchMove(host!, { touches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
      fireEvent.touchEnd(host!, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    }

    swipe(10, 140);
    expect(screen.getByRole('link', { name: '会话' }).getAttribute('aria-current')).toBe('page');

    swipe(-120);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: '统计' }).getAttribute('aria-current')).toBe('page'),
    );

    swipe(120);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: '会话' }).getAttribute('aria-current')).toBe('page'),
    );
  });
});

describe('对话历史抽屉', () => {
  it('打开后按时间分组，行内是会话标题与最后一条消息', async () => {
    renderShell('/');
    fireEvent.click(screen.getByRole('button', { name: '对话历史' }));

    const drawer = await screen.findByRole('dialog', { name: '对话历史' });
    expect(await within(drawer).findByText('今天')).toBeDefined();
    expect(within(drawer).getByText('今天休息')).toBeDefined();
    expect(within(drawer).getByText(/收到，今天先好好休息。/)).toBeDefined();
    expect(within(drawer).getByRole('button', { name: '创建新会话' })).toBeDefined();
  });

  it('点会话恢复消息与卡片，抽屉关闭', async () => {
    renderShell('/');
    fireEvent.click(screen.getByRole('button', { name: '对话历史' }));
    const drawer = await screen.findByRole('dialog', { name: '对话历史' });
    fireEvent.click(await within(drawer).findByText('今天休息'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('收到，今天先好好休息。')).toBeDefined();
    expect(localStorage.getItem('know-fit:conversation-id')).toBe('c-1');
  });

  it('点遮罩与 Escape 都能收起', async () => {
    renderShell('/');
    fireEvent.click(screen.getByRole('button', { name: '对话历史' }));
    await screen.findByRole('dialog', { name: '对话历史' });
    fireEvent.click(document.querySelector('.scrim') as Element);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '对话历史' }));
    expect(await screen.findByRole('dialog')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('创建新会话', () => {
  it('清空当前对话视图与草稿，不触碰服务端', async () => {
    const fetchMock = renderShell('/');
    const input = screen.getByLabelText('训练、饮食或提问') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '今天休息' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(
      await screen.findByText('收到，今天先好好休息。', undefined, { timeout: 3000 }),
    ).toBeDefined();

    fireEvent.change(input, { target: { value: '下一条草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '创建新会话' }));

    await waitFor(() => expect(screen.queryByText('收到，今天先好好休息。')).toBeNull());
    expect(input.value).toBe('');
    expect(localStorage.getItem('know-fit:chat-draft')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/turns')).toBe(true);
  });
});