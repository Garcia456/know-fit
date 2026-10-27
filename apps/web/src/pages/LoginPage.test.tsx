import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import type { Account } from '../api/types';
import { LoginPage } from './LoginPage';

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

function stubLogin(loginStatus: number) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return res(401, { error: '请先登录' });
    if (url === '/api/auth/login' && init?.method === 'POST') {
      return loginStatus === 200
        ? res(200, { user: me })
        : res(401, { error: '邮箱或密码不对' });
    }
    return res(200, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>会话首页</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('登录页', () => {
  it('演示账号一键填入，提交后进入首页', async () => {
    const fetchMock = stubLogin(200);
    renderLogin();

    fireEvent.click(await screen.findByRole('button', { name: /demo@knowfit\.local/ }));
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('demo@knowfit.local');
    expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('knowfit-demo');

    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('会话首页')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'demo@knowfit.local', password: 'knowfit-demo' }),
      }),
    );
  });

  it('密码不对时留在页面并显示后端原文', async () => {
    stubLogin(401);
    renderLogin();

    fireEvent.change(await screen.findByLabelText('邮箱'), {
      target: { value: 'demo@knowfit.local' },
    });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('邮箱或密码不对'));
    expect(screen.queryByText('会话首页')).toBeNull();
  });
});