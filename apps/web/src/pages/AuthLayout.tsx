import type { ReactNode } from 'react';

/** 登录 / 注册共用外壳：窄屏一张卡片，回到「一个入口」的克制感。 */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-mark" aria-hidden="true">
            KF
          </span>
          <span>know-fit</span>
        </div>
        <h1>{title}</h1>
        <p className="auth-sub">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}