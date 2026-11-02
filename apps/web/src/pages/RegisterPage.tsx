import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from './AuthLayout';

/** 注册页：邮箱 + 密码 + 昵称 + 邀请码；注册成功即登录，没有验证码环节。 */
export function RegisterPage() {
  const { status, signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const mail = email.trim();
    const name = nickname.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError('邮箱格式不对');
      return;
    }
    if (name.length === 0 || name.length > 20) {
      setError('昵称 1–20 字');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const code = inviteCode.trim();
      await signUp({
        email: mail,
        password,
        nickname: name,
        ...(code ? { invite_code: code } : {}),
      });
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '注册失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <AuthLayout title="注册" subtitle="一个账号收好所有训练记录。">
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
          <span>昵称</span>
          <input
            type="text"
            autoComplete="nickname"
            placeholder="怎么称呼你"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          <span>邀请码</span>
          <input
            type="text"
            autoComplete="off"
            placeholder="内测阶段请向作者索取"
            maxLength={128}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="至少 8 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          <span>确认密码</span>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="再输一次"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn btn--block" disabled={submitting}>
          {submitting ? '正在注册…' : '注册并开始'}
        </button>
      </form>

      <p className="auth-links">
        已经有账号？<Link to="/login">去登录</Link>
      </p>
    </AuthLayout>
  );
}