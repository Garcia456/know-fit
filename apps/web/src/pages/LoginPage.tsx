import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from './AuthLayout';

const DEMO_EMAIL = 'demo@knowfit.local';
const DEMO_PASSWORD = 'knowfit-demo';

/** 登录页。演示账号一键填入，方便作者/面试官直接看到有数据的界面。 */
export function LoginPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const state = location.state as { from?: unknown } | null;
  const from =
    typeof state?.from === 'string' && state.from.startsWith('/') ? state.from : '/';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <AuthLayout title="登录" subtitle="接着上次的训练记录往下走。">
      <form onSubmit={handleSubmit} noValidate>
        <label className="auth-field">
          <span>邮箱</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="至少 8 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn btn--block" disabled={submitting}>
          {submitting ? '正在登录…' : '登录'}
        </button>
      </form>

      <p className="auth-links">
        还没有账号？<Link to="/register">注册一个</Link>
      </p>

      <div className="auth-demo">
        <p>演示账号</p>
        <button
          type="button"
          className="auth-demo__fill"
          onClick={() => {
            setEmail(DEMO_EMAIL);
            setPassword(DEMO_PASSWORD);
            setError(null);
          }}
        >
          {DEMO_EMAIL} · {DEMO_PASSWORD}
        </button>
        <p className="card-meta">演示账号里有已有的训练记录；新注册的账号从空白开始。</p>
      </div>
    </AuthLayout>
  );
}