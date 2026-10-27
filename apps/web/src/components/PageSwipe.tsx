import { animate, m, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { decideSwipe, PAGE_ORDER } from '../lib/swipe';

interface Gesture {
  startX: number;
  startY: number;
  axis: 'x' | 'y' | null;
  ignored: boolean;
  lastX: number;
  lastT: number;
  vx: number;
}

const IGNORE = '[data-swipe-ignore], input, textarea, select, [contenteditable="true"]';

/** 四页左右滑；起点在日历、横向图表、输入框时不抢手势。 */
export function PageSwipe({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const index = PAGE_ORDER.indexOf(pathname as (typeof PAGE_ORDER)[number]);
  const dragX = useMotionValue(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const prevIndex = useRef(index);
  const anim = useRef<AnimationPlaybackControls | null>(null);

  const direction = index > prevIndex.current ? 1 : index < prevIndex.current ? -1 : 0;

  // 换页方向已知，从对应一侧滑入
  useLayoutEffect(() => {
    prevIndex.current = index;
    anim.current?.stop();
    if (reduced) {
      dragX.set(0);
      return;
    }
    if (direction !== 0) {
      dragX.set(direction * 32);
      anim.current = animate(dragX, 0, { type: 'spring', stiffness: 520, damping: 42 });
    } else {
      dragX.set(0);
    }
  }, [index, direction, reduced, dragX]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reduced || index < 0) return;

    function onStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (!touch) return;
      anim.current?.stop();
      gesture.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        axis: null,
        ignored: Boolean((e.target as Element | null)?.closest?.(IGNORE)),
        lastX: touch.clientX,
        lastT: performance.now(),
        vx: 0,
      };
    }

    function onMove(e: TouchEvent) {
      const g = gesture.current;
      const touch = e.touches[0];
      if (!g || !touch || g.ignored) return;

      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;
      if (g.axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // 纵向优先，避免抢页面滚动
        g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      }
      if (g.axis !== 'x') return;

      if (e.cancelable) e.preventDefault();
      const atEdge = (index === 0 && dx > 0) || (index === PAGE_ORDER.length - 1 && dx < 0);
      dragX.set(atEdge ? dx * 0.2 : dx * 0.9);

      const now = performance.now();
      const dt = now - g.lastT;
      if (dt > 0) g.vx = ((touch.clientX - g.lastX) / dt) * 1000;
      g.lastX = touch.clientX;
      g.lastT = now;
    }

    function onEnd() {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.ignored || g.axis !== 'x') return;

      const dx = dragX.get();
      const step = decideSwipe({ dx, dy: 0, vx: g.vx });
      const target = step === 0 ? undefined : PAGE_ORDER[index + step];
      if (target) {
        navigate(target);
        return;
      }
      anim.current = animate(dragX, 0, { type: 'spring', stiffness: 520, damping: 42 });
    }

    host.addEventListener('touchstart', onStart, { passive: true });
    host.addEventListener('touchmove', onMove, { passive: false });
    host.addEventListener('touchend', onEnd);
    host.addEventListener('touchcancel', onEnd);
    return () => {
      host.removeEventListener('touchstart', onStart);
      host.removeEventListener('touchmove', onMove);
      host.removeEventListener('touchend', onEnd);
      host.removeEventListener('touchcancel', onEnd);
    };
  }, [index, navigate, reduced, dragX]);

  return (
    <m.div ref={hostRef} className="page-swipe" style={{ x: dragX }}>
      {children}
    </m.div>
  );
}