import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';
import { SettingsPage } from './SettingsPage';

const me: Account = {
  id: 'u-1',
  email: 'demo@knowfit.local',
  nickname: 'Garcia',
  birthday: '2000-01-15',
  gender: '男',
  bio: '练了三年',
  avatar: null,
  age: 26,
  created_at: '2026-10-01T00:00:00.000Z',
  invite_unlocked: false,
  email_verified: true,
  free_turns_used: 0,
  free_turns_limit: 20,
};

function res(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

const aiView = {
  email_verified: true,
  invite_unlocked: false,
  quota: { used: 3, limit: 20, remaining: 17 },
  key: null,
  models: ['deepseek-flash', 'deepseek-v4-pro'],
};

function stubApi() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return res(200, { user: me });
    if (url === '/api/account/ai') return res(200, aiView);
    if (url === '/api/account/ai/key' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { model: string };
      return res(200, {
        ok: true,
        key: {
          configured: true,
          model: body.model,
          hint: 'wxyz',
          updated_at: '2026-11-22T00:00:00.000Z',
        },
      });
    }
    if (url === '/api/account/ai/key' && init?.method === 'DELETE') return res(200, { ok: true });
    if (url === '/api/account' && init?.method === 'PATCH') {
      return res(200, { user: { ...me, ...JSON.parse(String(init.body)) } });
    }
    if (url === '/api/account/training-records' && init?.method === 'DELETE') {
      return res(200, {
        ok: true,
        cleared: { sessions: 3, assessments: 2, turns: 8, nudges: 1 },
      });
    }
    if (url === '/api/account' && init?.method === 'DELETE') return res(200, { ok: true });
    if (url === '/api/auth/logout') return res(200, { ok: true });
    return res(200, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderSettings() {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <AuthProvider>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<p>登录页</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('设置页', () => {
  it('点头像看大图，大图里换头像，点屏幕退出', async () => {
    const withAvatar = { ...me, avatar: 'data:image/jpeg;base64,AAAA' };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/auth/me') return res(200, { user: withAvatar });
        return res(200, {});
      }),
    );
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '查看头像' }));
    expect(screen.getByLabelText('头像大图')).toBeDefined();
    expect(screen.getByRole('button', { name: '更换头像' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '移除头像' })).toBeNull();

    fireEvent.click(document.querySelector('.dialog-mask')!);
    expect(screen.queryByLabelText('头像大图')).toBeNull();
  });
  it('回显账号资料，改昵称与签名后提交 PATCH', async () => {
    const fetchMock = stubApi();
    renderSettings();

    const nickname = (await screen.findByLabelText('昵称')) as HTMLInputElement;
    expect(nickname.value).toBe('Garcia');
    expect(screen.getByText('demo@knowfit.local')).toBeDefined();

    fireEvent.change(nickname, { target: { value: '新名字' } });
    fireEvent.change(screen.getByLabelText('个性签名'), {
      target: { value: '练背日不缺席' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));

    expect(await screen.findByText('已保存')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          nickname: '新名字',
          birthday: '2000-01-15',
          gender: '男',
          bio: '练背日不缺席',
        }),
      }),
    );
  });

  it('生日用年 / 月 / 日滚轮，选完提交 PATCH', async () => {
    const fetchMock = stubApi();
    renderSettings();

    fireEvent.click(await screen.findByLabelText('生日日期'));
    fireEvent.click(await screen.findByRole('option', { name: '1998年' }));
    fireEvent.click(screen.getByRole('option', { name: '5月' }));
    fireEvent.click(screen.getByRole('option', { name: '12日' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(screen.getByText('1998-05-12')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));

    expect(await screen.findByText('已保存')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          nickname: 'Garcia',
          birthday: '1998-05-12',
          gender: '男',
          bio: '练了三年',
        }),
      }),
    );
  });

  it('未解锁时填邀请码开启知识库', async () => {
    const fetchMock = stubApi();
    renderSettings();

    const input = (await screen.findByLabelText('知识库邀请码')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  dev-knowledge-invite  ' } });
    fireEvent.click(screen.getByRole('button', { name: '开启知识库' }));

    expect(await screen.findByText('已开启')).toBeDefined();
    expect(screen.queryByLabelText('知识库邀请码')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/knowledge-access',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ invite_code: 'dev-knowledge-invite' }),
      }),
    );
  });

  it('邀请码不对时直接显示后端文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/auth/me') return res(200, { user: me });
        if (url === '/api/account/knowledge-access') return res(403, { error: '邀请码不对' });
        return res(200, {});
      }),
    );
    renderSettings();

    fireEvent.change(await screen.findByLabelText('知识库邀请码'), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开启知识库' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('邀请码不对');
    expect(screen.queryByText('已开启')).toBeNull();
  });

  it('默认使用系统模型，不显示额度与 API Key 输入', async () => {
    stubApi();
    renderSettings();

    const model = (await screen.findByRole('combobox', { name: '模型' })) as HTMLButtonElement;
    await waitFor(() => expect(model.disabled).toBe(false));
    expect(model.textContent).toContain('系统');
    expect(screen.queryByLabelText('DeepSeek API Key')).toBeNull();
    expect(screen.queryByText('对话额度')).toBeNull();
  });

  it('选 deepseek-flash 后出现 API Key，保存后只显示末 4 位', async () => {
    const fetchMock = stubApi();
    renderSettings();

    const model = (await screen.findByRole('combobox', { name: '模型' })) as HTMLButtonElement;
    await waitFor(() => expect(model.disabled).toBe(false));
    fireEvent.click(model);
    fireEvent.click(screen.getByRole('option', { name: /deepseek-flash/ }));

    const input = (await screen.findByLabelText('DeepSeek API Key')) as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: 'sk-test-user-key-0000wxyz' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 Key' }));

    expect(await screen.findByText('已保存')).toBeDefined();
    const after = screen.getByLabelText('DeepSeek API Key') as HTMLInputElement;
    expect(after.value).toBe('');
    expect(after.placeholder).toContain('末 4 位 wxyz');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/ai/key',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          api_key: 'sk-test-user-key-0000wxyz',
          model: 'deepseek-flash',
        }),
      }),
    );
  });

  it('已有 Key 时默认 deepseek-flash，切回系统保存会删除 Key', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return res(200, { user: me });
      if (url === '/api/account/ai') {
        return res(200, {
          ...aiView,
          key: {
            configured: true,
            model: 'deepseek-flash',
            hint: 'abcd',
            updated_at: '2026-11-01T00:00:00.000Z',
          },
        });
      }
      if (url === '/api/account/ai/key' && init?.method === 'DELETE') return res(200, { ok: true });
      return res(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    renderSettings();

    const model = (await screen.findByRole('combobox', { name: '模型' })) as HTMLButtonElement;
    await waitFor(() => expect(model.textContent).toContain('deepseek-flash'));
    const input = screen.getByLabelText('DeepSeek API Key') as HTMLInputElement;
    expect(input.placeholder).toContain('末 4 位 abcd');

    fireEvent.click(model);
    fireEvent.click(screen.getByRole('option', { name: /系统/ }));
    expect(screen.queryByLabelText('DeepSeek API Key')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('已保存')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/ai/key',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('Key 无效时显示后端文案，不显示已保存', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/auth/me') return res(200, { user: me });
        if (url === '/api/account/ai') return res(200, aiView);
        if (url === '/api/account/ai/key' && init?.method === 'PUT') {
          return res(400, { error: 'API Key 无效或已过期 —— 请在设置里重新填写' });
        }
        return res(200, {});
      }),
    );
    renderSettings();

    const model = (await screen.findByRole('combobox', { name: '模型' })) as HTMLButtonElement;
    await waitFor(() => expect(model.disabled).toBe(false));
    fireEvent.click(model);
    fireEvent.click(screen.getByRole('option', { name: /deepseek-flash/ }));
    fireEvent.change(await screen.findByLabelText('DeepSeek API Key'), {
      target: { value: 'sk-bad-key-00000000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Key' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('API Key 无效');
    expect(screen.queryByText('已保存')).toBeNull();
  });

  it('清空训练记录要二次确认，成功后报出清掉的条数', async () => {
    const fetchMock = stubApi();
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: /清空训练记录/ }));
    expect(screen.getByRole('alertdialog', { name: '确认清空训练记录' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }));

    expect(await screen.findByRole('status')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('训练 3 次');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/training-records',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('注销必须输入「注销」，确认后删除账号并回登录页', async () => {
    const fetchMock = stubApi();
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: /注销账号/ }));
    const confirm = screen.getByRole('button', { name: '确认注销' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('输入注销确认'), { target: { value: '注销' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    expect(await screen.findByText('登录页')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('退出登录清掉会话并回登录页', async () => {
    const fetchMock = stubApi();
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: /退出登录/ }));

    expect(await screen.findByText('登录页')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});