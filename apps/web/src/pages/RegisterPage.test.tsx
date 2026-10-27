import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { RegisterPage } from './RegisterPage';

function res(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stub(registerStatus: number) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return res(401, { error: '请先登录' });
    if (url === '/api/auth/register' && init?.method === 'POST') {
      return registerStatus === 200
        ? res(200, {
            user: {
              id: 'u-2',
              email: 'new@example.com',
              nickname: '新人',
              birthday: null,
              gender: null,
              bio: null,
              age: null,
              created_at: '2026-10-27T00:00:00.000Z',
            },
          })
        : res(409, { error: '这个邮箱已经注册过了' });
    }
    return res(200, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderRegister() {
  render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
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

describe('注册页', () => {
  it('两次密码不一致时本地拦下，不发请求', async () => {
    const fetchMock = stub(200);
    renderRegister();

    fireEvent.change(await screen.findByLabelText('邮箱'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '新人' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'knowfit-123' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'knowfit-456' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始' }));

    expect(await screen.findByText('两次输入的密码不一致')).toBeDefined();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/register')).toBe(false);
  });

  it('注册成功后自动登录并进入首页', async () => {
    const fetchMock = stub(200);
    renderRegister();

    fireEvent.change(await screen.findByLabelText('邮箱'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '新人' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'knowfit-123' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'knowfit-123' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始' }));

    expect(await screen.findByText('会话首页')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'knowfit-123',
          nickname: '新人',
        }),
      }),
    );
  });

  it('邮箱已注册时显示后端原文', async () => {
    stub(409);
    renderRegister();

    fireEvent.change(await screen.findByLabelText('邮箱'), {
      target: { value: 'used@example.com' },
    });
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '新人' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'knowfit-123' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'knowfit-123' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('这个邮箱已经注册过了'),
    );
  });
});