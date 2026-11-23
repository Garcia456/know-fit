import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { postRegisterCode } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from './AuthLayout';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;
const RESEND_SECONDS = 60;

type Field = 'email' | 'nickname' | 'password' | 'confirm' | 'code';
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, string>>;

const FIELD_ORDER: Field[] = ['email', 'code', 'nickname', 'password', 'confirm'];
const EMPTY: Values = {
  email: '',
  nickname: '',
  password: '',
  confirm: '',
  code: '',
};

/** 提交与「已提示过」的字段用这套规则；失焦时再宽松一点（见 blurError）。 */
function formatError(field: Field, values: Values): string | undefined {
  switch (field) {
    case 'email': {
      const value = values.email.trim();
      if (!value) return '请输入邮箱';
      return EMAIL_RE.test(value) ? undefined : '邮箱格式不对，比如 you@example.com';
    }
    case 'nickname': {
      const value = values.nickname.trim();
      if (!value) return '请输入昵称';
      return value.length <= 20 ? undefined : '昵称最多 20 字';
    }
    case 'password':
      return values.password.length >= 8 ? undefined : '密码至少 8 位';
    case 'confirm':
      return values.confirm === values.password ? undefined : '两次输入的密码不一致';
    case 'code': {
      const value = values.code.trim();
      if (!value) return '请输入邮箱验证码';
      return CODE_RE.test(value) ? undefined : '验证码是 6 位数字';
    }
  }
}

/** 失焦只报格式错误；空字段先不催，免得 Tab 过一遍满屏红。 */
function blurError(field: Field, values: Values): string | undefined {
  if (!values[field].trim()) return undefined;
  return formatError(field, values);
}

/**
 * 注册页：邮箱验证码是注册的一部分 —— 没验证成功就不建账号。
 * 各字段失焦即校验并就地提示。
 */
export function RegisterPage() {
  const { status, signUp } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function change(field: Field, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    setError(null);
    setErrors((prev) => {
      const out = { ...prev };
      if (touched[field] || out[field]) out[field] = formatError(field, next);
      // 改密码时，已经提示过的「确认密码」跟着重新判定
      if (field === 'password' && (touched.confirm || out.confirm)) {
        out.confirm = formatError('confirm', next);
      }
      return out;
    });
  }

  function blur(field: Field) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => {
      const out = { ...prev };
      const message = blurError(field, values);
      if (message) out[field] = message;
      else delete out[field];
      if (field === 'password' && touched.confirm) {
        const confirmMessage = blurError('confirm', values);
        if (confirmMessage) out.confirm = confirmMessage;
        else delete out.confirm;
      }
      return out;
    });
  }

  async function handleSendCode() {
    setTouched((prev) => ({ ...prev, email: true }));
    const emailMessage = formatError('email', values);
    if (emailMessage) {
      setErrors((prev) => ({ ...prev, email: emailMessage }));
      emailRef.current?.focus();
      return;
    }

    setSendingCode(true);
    setError(null);
    setNotice(null);
    try {
      const mail = values.email.trim();
      await postRegisterCode(mail);
      setCodeSentTo(mail);
      setCooldown(RESEND_SECONDS);
      setNotice(`验证码已发送至 ${mail}，10 分钟内有效`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证码发送失败，请重试');
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const nextErrors: FieldErrors = {};
    for (const field of FIELD_ORDER) nextErrors[field] = formatError(field, values);
    setTouched({
      email: true,
      nickname: true,
      password: true,
      confirm: true,
      code: true,
    });
    setErrors(nextErrors);
    setError(null);

    const firstBad = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstBad) {
      const refs: Record<Field, RefObject<HTMLInputElement | null>> = {
        email: emailRef,
        nickname: nicknameRef,
        password: passwordRef,
        confirm: confirmRef,
        code: codeRef,
      };
      refs[firstBad].current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await signUp({
        email: values.email.trim(),
        password: values.password,
        nickname: values.nickname.trim(),
        code: values.code.trim(),
      });
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '注册失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const sendLabel = sendingCode
    ? '发送中…'
    : cooldown > 0
      ? `${cooldown}s 后重发`
      : codeSentTo
        ? '重新发送'
        : '获取验证码';
  const emailChanged = codeSentTo !== null && values.email.trim() !== codeSentTo;

  return (
    <AuthLayout title="注册" subtitle="邮箱验证通过后，账号立即生效。">
      <form onSubmit={handleSubmit} noValidate>
        <div className={errors.email ? 'auth-field has-error' : 'auth-field'}>
          <label htmlFor="register-email">邮箱</label>
          <input
            id="register-email"
            ref={emailRef}
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={values.email}
            onChange={(e) => change('email', e.target.value)}
            onBlur={() => blur('email')}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'register-email-error' : undefined}
            required
          />
          {errors.email ? (
            <span id="register-email-error" className="auth-field__error" role="alert">
              {errors.email}
            </span>
          ) : null}
        </div>

        <div className={errors.code ? 'auth-field has-error' : 'auth-field'}>
          <label htmlFor="register-code">邮箱验证码</label>
          <div className="auth-field__row">
            <input
              id="register-code"
              ref={codeRef}
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 位数字"
              value={values.code}
              onChange={(e) => change('code', e.target.value)}
              onBlur={() => blur('code')}
              aria-invalid={Boolean(errors.code)}
              aria-describedby={errors.code ? 'register-code-error' : undefined}
              required
            />
            <button
              type="button"
              className="btn btn--ghost auth-field__send"
              onClick={handleSendCode}
              disabled={sendingCode || cooldown > 0}
            >
              {sendLabel}
            </button>
          </div>
          {errors.code ? (
            <span id="register-code-error" className="auth-field__error" role="alert">
              {errors.code}
            </span>
          ) : null}
          {notice ? (
            <span className="auth-field__hint" role="status">
              {notice}
            </span>
          ) : null}
          {emailChanged ? (
            <span className="auth-field__hint">邮箱改过了，请重新获取验证码</span>
          ) : null}
        </div>

        <div className={errors.nickname ? 'auth-field has-error' : 'auth-field'}>
          <label htmlFor="register-nickname">昵称</label>
          <input
            id="register-nickname"
            ref={nicknameRef}
            type="text"
            autoComplete="nickname"
            placeholder="怎么称呼你"
            maxLength={20}
            value={values.nickname}
            onChange={(e) => change('nickname', e.target.value)}
            onBlur={() => blur('nickname')}
            aria-invalid={Boolean(errors.nickname)}
            aria-describedby={errors.nickname ? 'register-nickname-error' : undefined}
            required
          />
          {errors.nickname ? (
            <span id="register-nickname-error" className="auth-field__error" role="alert">
              {errors.nickname}
            </span>
          ) : null}
        </div>

        <div className={errors.password ? 'auth-field has-error' : 'auth-field'}>
          <label htmlFor="register-password">密码</label>
          <input
            id="register-password"
            ref={passwordRef}
            type="password"
            autoComplete="new-password"
            placeholder="至少 8 位"
            value={values.password}
            onChange={(e) => change('password', e.target.value)}
            onBlur={() => blur('password')}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'register-password-error' : undefined}
            required
          />
          {errors.password ? (
            <span id="register-password-error" className="auth-field__error" role="alert">
              {errors.password}
            </span>
          ) : null}
        </div>

        <div className={errors.confirm ? 'auth-field has-error' : 'auth-field'}>
          <label htmlFor="register-confirm">确认密码</label>
          <input
            id="register-confirm"
            ref={confirmRef}
            type="password"
            autoComplete="new-password"
            placeholder="再输一次"
            value={values.confirm}
            onChange={(e) => change('confirm', e.target.value)}
            onBlur={() => blur('confirm')}
            aria-invalid={Boolean(errors.confirm)}
            aria-describedby={errors.confirm ? 'register-confirm-error' : undefined}
            required
          />
          {errors.confirm ? (
            <span id="register-confirm-error" className="auth-field__error" role="alert">
              {errors.confirm}
            </span>
          ) : null}
        </div>

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
