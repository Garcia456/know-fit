import { m, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const [scrolled, setScrolled] = useState(false);

  // 页面滚起来以后给导航补一道底边：文字从下面滑过时不再贴脸。
  useEffect(() => {
    function sync(target: EventTarget | null) {
      const page = target instanceof Element ? target.closest('.page-body') : null;
      if (page) setScrolled(page.scrollTop > 4);
    }
    function onScroll(e: Event) {
      sync(e.target);
    }
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  useEffect(() => {
    const visible = [...document.querySelectorAll<HTMLElement>('.page-body')].find(
      (el) => el.getClientRects().length > 0,
    );
    setScrolled((visible?.scrollTop ?? 0) > 4);
  }, [pathname]);

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
    <nav className={`topnav${scrolled ? ' is-scrolled' : ''}`} aria-label="主导航">
      <div className="topnav__side">
        <span className="topnav__brand" aria-hidden="true">
          know-fit
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="对话历史"
          onClick={onOpenHistory}
        >
          <HistoryIcon />
        </button>
      </div>
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
      <div className="topnav__side topnav__side--end">
        <button
          type="button"
          className="icon-btn icon-btn--dark"
          aria-label="创建新会话"
          onClick={onNewConversation}
        >
          <NewConversationIcon />
        </button>
      </div>
    </nav>
  );
}
