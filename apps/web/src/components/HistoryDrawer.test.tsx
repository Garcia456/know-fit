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

describe('多选', () => {
  const rows = [
    item('a', new Date(2026, 9, 29, 10)),
    item('b', new Date(2026, 9, 28, 10)),
    item('c', new Date(2026, 9, 27, 10)),
  ];

  function renderDrawer() {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 204, json: async () => undefined });
      }
      if (init?.method === 'PATCH') {
        const { pinned } = JSON.parse(String(init.body)) as { pinned?: boolean };
        const id = String(url).split('/').pop() ?? 'a';
        const base = rows.find((r) => r.id === id) ?? rows[0]!;
        return json({
          conversation: {
            ...base,
            pinned_at: pinned ? new Date().toISOString() : null,
          },
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

  async function enterSelecting() {
    fireEvent.click(await screen.findByRole('button', { name: '多选' }));
    expect(screen.getByRole('heading', { name: '选择会话' })).toBeDefined();
  }

  it('点标题右侧按钮进入多选，每行出现 checkbox，底栏换成置顶/删除', async () => {
    renderDrawer();
    await enterSelecting();

    expect(screen.getAllByRole('checkbox')).toHaveLength(rows.length);
    expect(screen.queryByRole('button', { name: '创建新会话' })).toBeNull();
    expect(screen.getByRole('button', { name: /置顶/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /删除/ })).toBeDefined();
  });

  it('多选时点行只切换选中，不打开会话', async () => {
    const onSelectConversation = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json({ conversations: rows })),
    );
    render(
      <HistoryDrawer
        open
        onClose={() => undefined}
        onSelectConversation={onSelectConversation}
        onDeleted={() => undefined}
        onNewConversation={() => undefined}
      />,
    );
    await enterSelecting();

    const box = screen.getByRole('checkbox', { name: '选择 会话 a' });
    fireEvent.click(box);

    expect(screen.getByRole('checkbox', { name: '取消选择 会话 a' })).toBeDefined();
    expect(onSelectConversation).not.toHaveBeenCalled();
  });

  it('置顶按钮只 PATCH 选中的会话', async () => {
    const fetchMock = renderDrawer();
    await enterSelecting();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 会话 a' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 会话 b' }));
    fireEvent.click(screen.getByRole('button', { name: /置顶/ }));

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
      expect(patches).toHaveLength(2);
      const ids = patches.map(([url]) => String(url).split('/').pop());
      expect(new Set(ids)).toEqual(new Set(['a', 'b']));
      for (const [, init] of patches) {
        expect(JSON.parse(String(init?.body))).toEqual({ pinned: true });
      }
    });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '选择会话' })).toBeNull();
    });
  });

  it('删除要先弹窗确认，确认后才 DELETE 每个选中的会话', async () => {
    const fetchMock = renderDrawer();
    await enterSelecting();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 会话 a' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 会话 c' }));
    fireEvent.click(screen.getByRole('button', { name: /删除/ }));

    const dialog = await screen.findByRole('dialog', { name: '删除 2 个会话' });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
      expect(deletes).toHaveLength(2);
      const ids = deletes.map(([url]) => String(url).split('/').pop());
      expect(new Set(ids)).toEqual(new Set(['a', 'c']));
    });
  });
});