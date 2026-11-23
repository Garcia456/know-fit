import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { VerifyEmailPage } from './VerifyEmailPage';

function res(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function renderPage(initial: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function verifyMock(verifyResponse: Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return res(401, { error: '请先登录' });
    if (url === '/api/auth/verify-email' && init?.method === 'POST') return verifyResponse;
    return res(404, { error: '不该走的请求' });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('验证邮箱页', () => {
  it('用 URL 里的 token 兑换验证，成功后给出入口', async () => {
    const fetchMock = verifyMock(res(200, { ok: true, email_verified: true }));
    renderPage('/verify-email?token=abc', fetchMock);

    expect(await screen.findByText(/邮箱已验证/)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/verify-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'abc' }),
      }),
    );
  });

  it('令牌无效时显示后端文案', async () => {
    const fetchMock = verifyMock(res(400, { error: '验证链接无效或已过期' }));
    renderPage('/verify-email?token=bad', fetchMock);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('验证链接无效或已过期');
    expect(screen.getByRole('link', { name: '去登录' })).toBeDefined();
  });

  it('链接缺 token 时不发请求', async () => {
    const fetchMock = verifyMock(res(200, { ok: true, email_verified: true }));
    renderPage('/verify-email', fetchMock);

    expect(await screen.findByText('链接里缺少验证令牌')).toBeDefined();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/auth/verify-email'),
    ).toBe(false);
  });
});
