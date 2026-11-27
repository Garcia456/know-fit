import { animate, m, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { spring } from '../lib/motion';
import {
  isSubpage,
  pageIndexOf,
  decideSwipe,
  PAGE_ORDER,
  SWIPE_INTENT_PX,
} from '../lib/swipe';

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

/** 换页时新页面从对应一侧轻轻贴进来，不整屏横移。 */
const ENTER_OFFSET = 28;

/** 四页左右滑；起点在日历、横向图表、输入框时不抢手势。 */
export function PageSwipe({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const index = pageIndexOf(pathname);
  const subpage = isSubpage(pathname);
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
      dragX.set(direction * ENTER_OFFSET);
      anim.current = animate(dragX, 0, spring.snappy);
    } else {
      dragX.set(0);
    }
  }, [index, direction, reduced, dragX]);

  useEffect(() => {
    const host = hostRef.current;
    // 二级页不做左右翻页
    if (!host || reduced || index < 0 || subpage) return;

    function onStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (!touch) return;
      anim.current?.stop();
      // 只在真正拖动期间提示合成层，静止时不占常驻 GPU 资源
      host!.style.willChange = 'transform';
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
      if (!g || !touch) return;

      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;

      // 方向没定之前先不动。横向优先，但必须明确压过纵向 ——
      // 斜着滚动页面时不该把整页横着带歪。
      if (g.axis === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
      }
      if (g.axis !== 'x' || g.ignored) return;

      if (e.cancelable) e.preventDefault();

      const travel = Math.max(0, Math.abs(dx) - SWIPE_INTENT_PX);
      if (travel === 0) {
        dragX.set(0);
      } else {
        const atEdge = (index === 0 && dx > 0) || (index === PAGE_ORDER.length - 1 && dx < 0);
        dragX.set(Math.sign(dx) * travel * (atEdge ? 0.16 : 0.92));
      }

      const now = performance.now();
      const dt = now - g.lastT;
      if (dt > 0) g.vx = ((touch.clientX - g.lastX) / dt) * 1000;
      g.lastX = touch.clientX;
      g.lastT = now;
    }

    function onEnd() {
      const g = gesture.current;
      gesture.current = null;
      host!.style.willChange = '';
      if (!g) return;

      if (g.ignored || g.axis !== 'x') {
        anim.current = animate(dragX, 0, spring.snappy);
        return;
      }

      // 用原始位移判定，不用带死区和边缘阻尼的视觉位移
      const step = decideSwipe({ dx: g.lastX - g.startX, dy: 0, vx: g.vx });
      const target = step === 0 ? undefined : PAGE_ORDER[index + step];
      if (target) {
        navigate(target);
        return;
      }
      anim.current = animate(dragX, 0, spring.snappy);
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
      host.style.willChange = '';
    };
  }, [index, subpage, navigate, reduced, dragX]);

  return (
    <m.div ref={hostRef} className="page-swipe" style={{ x: dragX }}>
      {children}
    </m.div>
  );
}
