import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getMe, postVerifyEmail } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from './AuthLayout';

type Phase = 'verifying' | 'ok' | 'error';

/** 邮件验证落地页：用 URL 里的 token 换验证状态；新设备上打开也能用。 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { setUser } = useAuth();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [error, setError] = useState('验证链接无效或已过期');
  // StrictMode 下 effect 会跑两次 —— 令牌只能用一次，别让第二次把第一次的成功覆盖成失败
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setError('链接里缺少验证令牌');
      setPhase('error');
      return;
    }

    postVerifyEmail(token)
      .then(() => {
        setPhase('ok');
        // 已登录时顺手刷新用户，顶部提示条立刻消失；未登录就忽略
        getMe()
          .then(({ user }) => setUser(user))
          .catch(() => {});
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '验证链接无效或已过期');
        setPhase('error');
      });
  }, [token, setUser]);

  return (
    <AuthLayout title="验证邮箱" subtitle="验证后即可领取免费对话次数。">
      {phase === 'verifying' ? (
        <p className="auth-links" role="status">
          正在验证…
        </p>
      ) : null}

      {phase === 'ok' ? (
        <>
          <p className="auth-links" role="status">
            邮箱已验证，免费对话次数已开通。
          </p>
          <Link className="btn btn--block" to="/">
            开始训练记录
          </Link>
        </>
      ) : null}

      {phase === 'error' ? (
        <>
          <p className="error-text" role="alert">
            {error}
          </p>
          <p className="auth-links">登录后可以在会话页顶部重新发送验证邮件。</p>
          <Link className="btn btn--block" to="/login">
            去登录
          </Link>
        </>
      ) : null}
    </AuthLayout>
  );
}
