import { m, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { HistoryIcon, NewConversationIcon } from './Icons';

interface Props {
  onOpenHistory: () => void;
  onNewConversation: () => void;
}

const TABS = [
  { to: '/', label: '会话', end: true },
  { to: '/stats', label: '统计', end: false },
  { to: '/data', label: '历史', end: false },
  { to: '/profile', label: '我的', end: false },
];

/** 顶部导航：左抽屉 / 中四 tab（共用一块滑动色块）/ 右新会话。 */
export function TopNav({ onOpenHistory, onNewConversation }: Props) {
  const { pathname } = useLocation();
  const reduced = useReducedMotion();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ x: 0, w: 0 });

  useLayoutEffect(() => {
    function measure() {
      const host = tabsRef.current;
      const active = host?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!host || !active) return;
      setPill({ x: active.offsetLeft, w: active.offsetWidth });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pathname]);

  return (
    <nav className="topnav" aria-label="主导航">
      <button
        type="button"
        className="icon-btn"
        aria-label="对话历史"
        onClick={onOpenHistory}
      >
        <HistoryIcon />
      </button>
      <div className="tabs" ref={tabsRef}>
        {pill.w > 0 ? (
          <m.span
            className="tab-pill"
            aria-hidden="true"
            initial={false}
            animate={{ x: pill.x, width: pill.w }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: 'spring', stiffness: 520, damping: 40 }
            }
          />
        ) : null}
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="tab">
            {tab.label}
          </NavLink>
        ))}
      </div>
      <button
        type="button"
        className="icon-btn icon-btn--dark"
        aria-label="创建新会话"
        onClick={onNewConversation}
      >
        <NewConversationIcon />
      </button>
    </nav>
  );
}