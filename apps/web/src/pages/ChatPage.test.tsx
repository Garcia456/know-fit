import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnResponse } from '../api/types';
import { ChatPage } from './ChatPage';

const chatTurn: TurnResponse = {
  turn_id: 't-1',
  conversation_id: 'c-1',
  intent: 'chat',
  card: { kind: 'chat', reply: '收到，今天先好好休息。' },
  assessment: null,
  assessment_lookup: null,
  notices: [],
};

const lowDataTurn: TurnResponse = {
  turn_id: 't-2',
  conversation_id: 'c-2',
  intent: 'assess',
  card: {
    kind: 'workout',
    session_id: 's-1',
    date: '2026-10-26',
    split_label: '背日',
    status: 'incomplete',
    missing_fields: ['reps'],
    exercises: [],
    volume_kg: 0,
    working_sets: 0,
    note: null,
    hook: null,
  },
  assessment: null,
  assessment_lookup: { status: 'insufficient', missing: ['sets', 'baseline'] },
  notices: [],
};

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderChat(resetToken = 0) {
  render(
    <MemoryRouter>
      <ChatPage resetToken={resetToken} />
    </MemoryRouter>,
  );
}

describe('聊天页', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('发送后显示卡片，并清空输入与暂存', async () => {
    const fetchMock = mockFetchOnce(chatTurn);
    renderChat();

    const input = screen.getByLabelText('训练、饮食或提问');
    fireEvent.change(input, { target: { value: '今天休息' } });
    expect(localStorage.getItem('know-fit:chat-draft')).toBe('今天休息');

    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(screen.getByText('收到，今天先好好休息。')).toBeDefined(), {
      timeout: 3000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/turns',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: '今天休息' }) }),
    );
    expect((input as HTMLInputElement).value).toBe('');
    expect(localStorage.getItem('know-fit:chat-draft')).toBeNull();
  });

  it('点发送立刻上屏、清空输入，并显示思考中', async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      ),
    );
    renderChat();

    const input = screen.getByLabelText('训练、饮食或提问') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '今天休息' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(input.value).toBe('');
    expect(screen.getByText('今天休息')).toBeDefined();
    expect(screen.getByText('思考中...')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();

    resolve({ ok: true, status: 200, json: async () => chatTurn });
    await waitFor(() => expect(screen.getByText('收到，今天先好好休息。')).toBeDefined(), {
      timeout: 3000,
    });
    expect(screen.queryByText('思考中...')).toBeNull();
  });

  it('失败时文字不丢，给出重试', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('网络断了'));
    vi.stubGlobal('fetch', fetchMock);
    renderChat();

    const input = screen.getByLabelText('训练、饮食或提问') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '今天推日' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(input.value).toBe('今天推日');
    expect(localStorage.getItem('know-fit:chat-draft')).toBe('今天推日');
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('重进页面会恢复未发送的草稿', () => {
    localStorage.setItem('know-fit:chat-draft', '卧推 60kg 5×5');
    renderChat();
    expect(
      (screen.getByLabelText('训练、饮食或提问') as HTMLInputElement).value,
    ).toBe('卧推 60kg 5×5');
  });

  it('快捷提问不再出现半截话', () => {
    renderChat();
    expect(screen.queryByRole('button', { name: '今天练了背' })).toBeNull();
    expect(screen.queryByRole('button', { name: '补记昨天的推日' })).toBeNull();
  });

  it('完整问题点了直接发出去', async () => {
    const fetchMock = mockFetchOnce(chatTurn);
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: '增肌一周练几次' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/turns',
        expect.objectContaining({ body: JSON.stringify({ message: '增肌一周练几次' }) }),
      ),
    );
  });

  it('知识类提示词点了直接发', async () => {
    const fetchMock = mockFetchOnce(chatTurn);
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: '练胸有什么推荐动作' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/turns',
        expect.objectContaining({ body: JSON.stringify({ message: '练胸有什么推荐动作' }) }),
      ),
    );
  });

  it('数据不足时显示「暂时算不出判定」而不是给建议', async () => {
    mockFetchOnce(lowDataTurn);
    renderChat();
    fireEvent.change(screen.getByLabelText('训练、饮食或提问'), {
      target: { value: '我这样练够吗' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('暂时算不出判定', undefined, { timeout: 3000 })).toBeDefined();
    expect(screen.getByText('数据不足')).toBeDefined();
    expect(screen.getByText('还差 2 项才能算趋势')).toBeDefined();
    expect(screen.queryByText(/建议你/)).toBeNull();
  });
});

describe('会话恢复（StrictMode 双跑）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const detail = {
    id: 'c-1',
    title: 'hi',
    created_at: '2026-10-27T00:00:00.000Z',
    updated_at: '2026-10-27T00:00:00.000Z',
    last_message: '收到，今天先好好休息。',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: 'hi',
        intent: 'chat',
        response: null,
        created_at: '2026-10-27T00:00:00.000Z',
      },
      {
        id: 'm-2',
        role: 'assistant',
        content: '收到，今天先好好休息。',
        intent: 'chat',
        response: chatTurn,
        created_at: '2026-10-27T00:00:00.000Z',
      },
    ],
  };

  it('挂载不清掉当前会话，并把消息画回来', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => (url === '/api/conversations/c-1' ? detail : { nudge: null }),
        }),
      ),
    );
    localStorage.setItem('know-fit:conversation-id', 'c-1');

    render(
      <StrictMode>
        <MemoryRouter>
          <ChatPage resetToken={0} activeConversationId="c-1" />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByText('收到，今天先好好休息。')).toBeDefined();
    expect(localStorage.getItem('know-fit:conversation-id')).toBe('c-1');
  });
});

describe('F7 提示', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubNudge(nudge: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => (url === '/api/nudges/next' ? { nudge } : { ok: true }),
        }),
      ),
    );
  }

  it('补全提示给「补上 / 忽略」两个动作', async () => {
    stubNudge({
      id: '11111111-1111-4111-8111-111111111111',
      type: '补全',
      session_id: 's1',
      message: '背日好像没记完，补上？',
    });
    renderChat();

    expect(await screen.findByText('背日好像没记完，补上？')).toBeDefined();
    expect(screen.getByRole('button', { name: /补上/ })).toBeDefined();
    expect(screen.getByRole('button', { name: '忽略' })).toBeDefined();
  });

  it('断流提示只给「知道了」', async () => {
    stubNudge({
      id: '22222222-2222-4222-8222-222222222222',
      type: '断流',
      session_id: 's1',
      message: '上次训练是 9 天前',
    });
    renderChat();

    expect(await screen.findByText('上次训练是 9 天前')).toBeDefined();
    expect(screen.getByRole('button', { name: '知道了' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /补上/ })).toBeNull();
  });

  it('没有提示时不渲染任何提示条', async () => {
    stubNudge(null);
    renderChat();

    await waitFor(() => expect(screen.getByText(/今天练了什么/)).toBeDefined());
    expect(screen.queryByRole('status')).toBeNull();
  });
});