import { useState } from 'react';
import { postResendVerification } from '../api/client';
import { useAuthUser } from '../auth/AuthContext';
import { InfoIcon } from './Icons';

/** 邮箱未验证时的提示条：说清验证能换什么，并就地重发。 */
export function VerifyEmailBanner() {
  const user = useAuthUser();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.email_verified) return null;

  async function handleResend() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await postResendVerification();
      setMessage(res.sent ? '验证邮件已发送，请查收' : '邮箱已经验证过了');
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="note-inline verify-banner">
      <InfoIcon />
      <p>
        邮箱还没验证 —— 验证后领取免费对话次数。
        {message ? ` ${message}` : ''}
        {error ? (
          <span className="error-text" role="alert">
            {' '}
            {error}
          </span>
        ) : null}
      </p>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => void handleResend()}
        disabled={busy}
      >
        {busy ? '发送中…' : '重新发送'}
      </button>
    </div>
  );
}
