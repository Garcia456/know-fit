import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';
import { VerifyEmailBanner } from './VerifyEmailBanner';

const baseAccount: Account = {
  id: 'u-1',
  email: 'new@knowfit.local',
  nickname: '新人',
  birthday: null,
  gender: null,
  bio: null,
  avatar: null,
  age: null,
  created_at: '2026-11-20T00:00:00.000Z',
  invite_unlocked: false,
  email_verified: false,
  free_turns_used: 0,
  free_turns_limit: 20,
};

function res(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function renderBanner(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter>
      <AuthProvider>
        <VerifyEmailBanner />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('邮箱未验证提示条', () => {
  it('未验证时显示，点重新发送会调接口并反馈', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return res(200, { user: baseAccount });
      if (url === '/api/auth/verify-email/resend' && init?.method === 'POST') {
        return res(200, { ok: true, email_verified: false, sent: true });
      }
      return res(404, { error: '不该走的请求' });
    });
    renderBanner(fetchMock);

    expect(await screen.findByText(/邮箱还没验证/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重新发送' }));

    expect(await screen.findByText(/验证邮件已发送/)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/verify-email/resend',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('重发失败时直接显示后端文案', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return res(200, { user: baseAccount });
      if (url === '/api/auth/verify-email/resend' && init?.method === 'POST') {
        return res(429, { error: '验证邮件发得太频繁了，请稍后再试' });
      }
      return res(404, { error: '不该走的请求' });
    });
    renderBanner(fetchMock);

    fireEvent.click(await screen.findByRole('button', { name: '重新发送' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('验证邮件发得太频繁了');
  });

  it('已验证的账号不显示提示条', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') {
        return res(200, { user: { ...baseAccount, email_verified: true } });
      }
      return res(404, { error: '不该走的请求' });
    });
    renderBanner(fetchMock);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/邮箱还没验证/)).toBeNull();
  });
});
