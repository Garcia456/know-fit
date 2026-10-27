import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  age: 26,
  created_at: '2026-10-01T00:00:00.000Z',
};

function res(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubApi() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return res(200, { user: me });
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