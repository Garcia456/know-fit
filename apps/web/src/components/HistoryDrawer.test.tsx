import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '../api/types';
import { HistoryDrawer, groupByTime } from './HistoryDrawer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const now = new Date(2026, 9, 29, 12, 0, 0);

function item(
  id: string,
  updated: Date,
  pinned_at: string | null = null,
): ConversationSummary {
  return {
    id,
    title: `会话 ${id}`,
    created_at: updated.toISOString(),
    updated_at: updated.toISOString(),
    pinned_at,
    last_message: `最后一句 ${id}`,
  };
}

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

describe('会话分组', () => {
  it('按更新时间分今天 / 昨天 / 前天 / 7天内 / 月份，置顶单独一组', () => {
    const daysAgo = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d;
    };
    const groups = groupByTime(
      [
        item('p', daysAgo(20), new Date().toISOString()),
        item('t', daysAgo(0)),
        item('y', daysAgo(1)),
        item('b', daysAgo(2)),
        item('w', daysAgo(5)),
        item('sep', daysAgo(35)),
      ],
      now,
    );

    expect(groups.map((g) => g.label)).toEqual([
      '置顶',
      '今天',
      '昨天',
      '前天',
      '7天内',
      '2026年9月',
    ]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['p']);
  });
});

describe('长按菜单', () => {
  const rows = [
    item('a', new Date(2026, 9, 29, 10)),
    item('b', new Date(2026, 9, 28, 10)),
  ];

  function renderDrawer(patchBody?: (id: string) => ConversationSummary) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const { pinned } = JSON.parse(String(init.body)) as { pinned?: boolean };
        const id = String(url).split('/').pop() ?? 'a';
        const base = rows.find((r) => r.id === id) ?? rows[0]!;
        return json({
          conversation:
            patchBody?.(id) ??
            { ...base, pinned_at: pinned ? new Date().toISOString() : null },
        });
      }
      return json({ conversations: rows });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <HistoryDrawer
        open
        onClose={() => undefined}
        onSelectConversation={() => undefined}
        onDeleted={() => undefined}
        onNewConversation={() => undefined}
      />,
    );
    return fetchMock;
  }

  it('右键（长按）弹出置顶 / 重命名 / 删除', async () => {
    renderDrawer();
    const title = await screen.findByText('会话 a');
    fireEvent.contextMenu(title.closest('button') as Element);

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: '置顶' })).toBeDefined();
    expect(within(menu).getByRole('menuitem', { name: '重命名' })).toBeDefined();
    expect(within(menu).getByRole('menuitem', { name: '删除' })).toBeDefined();
  });

  it('置顶调 PATCH，并把会话挪进「置顶」分组', async () => {
    const fetchMock = renderDrawer();
    const title = await screen.findByText('会话 a');
    fireEvent.contextMenu(title.closest('button') as Element);
    fireEvent.click(await screen.findByRole('menuitem', { name: '置顶' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ pinned: true });
    });
    expect(await screen.findByText('置顶')).toBeDefined();
  });

  it('重命名弹出居中弹窗，保存后标题更新', async () => {
    renderDrawer((id) => ({
      ...(rows.find((r) => r.id === id) ?? rows[0]!),
      title: '改过的标题',
    }));
    const title = await screen.findByText('会话 a');
    fireEvent.contextMenu(title.closest('button') as Element);
    fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));

    const dialog = await screen.findByRole('dialog', { name: '重命名会话' });
    const input = within(dialog).getByLabelText('会话标题');
    fireEvent.change(input, { target: { value: '改过的标题' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(await screen.findByText('改过的标题')).toBeDefined();
  });
});