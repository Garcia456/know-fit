import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { EyeIcon, EyeOffIcon } from '../components/Icons';
import { AuthLayout } from './AuthLayout';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
}

export function LoginPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const state = location.state as { from?: unknown } | null;
  const from =
    typeof state?.from === 'string' && state.from.startsWith('/') ? state.from : '/';

  function changeEmail(value: string) {
    setEmail(value);
    setError(null);
    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
  }

  function changePassword(value: string) {
    setPassword(value);
    setError(null);
    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
  }

  /** 失焦只校验已填内容的格式；必填提示留给提交 */
  function checkEmailOnBlur() {
    const value = email.trim();
    if (!value) return;
    setErrors((prev) => ({
      ...prev,
      email: EMAIL_RE.test(value) ? undefined : '邮箱格式不对，比如 you@example.com',
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const next: FieldErrors = {};
    const emailText = email.trim();
    if (!emailText) next.email = '请输入邮箱';
    else if (!EMAIL_RE.test(emailText)) next.email = '邮箱格式不对，比如 you@example.com';
    if (!password) next.password = '请输入密码';

    setErrors(next);
    setError(null);
    if (next.email) {
      emailRef.current?.focus();
      return;
    }
    if (next.password) {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await signIn(emailText, password);
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
        <div className={errors.email ? 'auth-field has-error' : 'auth-field'}>
          <label htmlFor="login-email">邮箱</label>
          <input
            id="login-email"
            ref={emailRef}
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => changeEmail(e.target.value)}
            onBlur={checkEmailOnBlur}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
            autoFocus
          />
          {errors.email ? (
            <span id="login-email-error" className="auth-field__error" role="alert">
              {errors.email}
            </span>
          ) : null}
        </div>
        <div className={errors.password ? 'auth-field has-error' : 'auth-field'}>
          <label htmlFor="login-password">密码</label>
          <span className="auth-field__control">
            <input
              id="login-password"
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="至少 8 位"
              value={password}
              onChange={(e) => changePassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'login-password-error' : undefined}
            />
            <button
              type="button"
              className="auth-field__reveal"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              aria-pressed={showPassword}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </span>
          {errors.password ? (
            <span id="login-password-error" className="auth-field__error" role="alert">
              {errors.password}
            </span>
          ) : null}
        </div>

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
    </AuthLayout>
  );
}