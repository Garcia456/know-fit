import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { RegisterPage } from './RegisterPage';

function res(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stub(registerStatus: number, codeStatus = 200) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return res(401, { error: '请先登录' });
    if (url === '/api/auth/register/code' && init?.method === 'POST') {
      return codeStatus === 200
        ? res(200, { ok: true, sent: true, expires_in: 600 })
        : res(codeStatus, { error: '验证码发得太频繁了，请稍后再试' });
    }
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

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('邮箱'), {
    target: { value: 'new@example.com' },
  });
  fireEvent.change(screen.getByLabelText('邮箱验证码'), {
    target: { value: '123456' },
  });
  fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '新人' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'knowfit-123' } });
  fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'knowfit-123' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('注册页', () => {
  it('邮箱失焦后立即提示格式错误', async () => {
    stub(200);
    renderRegister();

    const email = await screen.findByLabelText('邮箱');
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.blur(email);

    expect(await screen.findByText('邮箱格式不对，比如 you@example.com')).toBeDefined();
  });

  it('密码 / 确认密码 / 验证码失焦后各自提示', async () => {
    stub(200);
    renderRegister();

    const password = await screen.findByLabelText('密码');
    fireEvent.change(password, { target: { value: 'short' } });
    fireEvent.blur(password);
    expect(await screen.findByText('密码至少 8 位')).toBeDefined();

    fireEvent.change(screen.getByLabelText('确认密码'), {
      target: { value: 'different' },
    });
    fireEvent.blur(screen.getByLabelText('确认密码'));
    expect(await screen.findByText('两次输入的密码不一致')).toBeDefined();

    fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '12' } });
    fireEvent.blur(screen.getByLabelText('邮箱验证码'));
    expect(await screen.findByText('验证码是 6 位数字')).toBeDefined();
  });

  it('获取验证码发到当前邮箱，并给出提示', async () => {
    const fetchMock = stub(200);
    renderRegister();

    fireEvent.change(await screen.findByLabelText('邮箱'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }));

    expect(await screen.findByText(/验证码已发送至 new@example.com/)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/register/code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com' }),
      }),
    );
  });

  it('验证码发送失败时显示后端原文', async () => {
    stub(200, 429);
    renderRegister();

    fireEvent.change(await screen.findByLabelText('邮箱'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('验证码发得太频繁了'),
    );
  });

  it('两次密码不一致时本地拦下，不发注册请求', async () => {
    const fetchMock = stub(200);
    renderRegister();

    fillValidForm();
    fireEvent.change(screen.getByLabelText('确认密码'), {
      target: { value: 'knowfit-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始' }));

    expect(await screen.findByText('两次输入的密码不一致')).toBeDefined();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/register')).toBe(false);
  });

  it('注册成功后自动登录并进入首页，注册请求带上验证码', async () => {
    const fetchMock = stub(200);
    renderRegister();

    fillValidForm();
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
          code: '123456',
        }),
      }),
    );
  });

  it('邮箱已注册时显示后端原文', async () => {
    stub(409);
    renderRegister();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: '注册并开始' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('这个邮箱已经注册过了'),
    );
  });
});
