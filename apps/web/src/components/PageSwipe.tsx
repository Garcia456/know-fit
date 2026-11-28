import { animate, m, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { spring } from '../lib/motion';
import {
  isSubpage,
  pageIndexOf,
  decideSwipe,
  swipeVelocity,
  PAGE_ORDER,
  SWIPE_INTENT_PX,
  type SwipeSample,
} from '../lib/swipe';

interface Gesture {
  startX: number;
  startY: number;
  axis: 'x' | 'y' | null;
  ignored: boolean;
  lastX: number;
  samples: SwipeSample[];
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
    // 二级页不做左右翻页；「减少动态效果」只去掉位移动画，不拿走翻页功能
    if (!host || index < 0 || subpage) return;

    function onStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (!touch) return;
      anim.current?.stop();
      // 只在真正拖动期间提示合成层，静止时不占常驻 GPU 资源
      if (!reduced) host!.style.willChange = 'transform';
      const now = performance.now();
      gesture.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        axis: null,
        ignored: Boolean((e.target as Element | null)?.closest?.(IGNORE)),
        lastX: touch.clientX,
        samples: [{ x: touch.clientX, t: now }],
      };
    }

    function onMove(e: TouchEvent) {
      const g = gesture.current;
      const touch = e.touches[0];
      if (!g || !touch) return;

      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;

      // 方向没定之前先不动。等横向明确越过意图距离再锁 x ——
      // 10px 的斜向移动就把轴锁成横向，会吞掉后面的纵向滚动。
      if (g.axis === null) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        if (Math.abs(dx) >= SWIPE_INTENT_PX && Math.abs(dx) > Math.abs(dy) * 1.3) {
          g.axis = 'x';
        } else if (Math.abs(dy) >= 12 && Math.abs(dy) >= Math.abs(dx)) {
          g.axis = 'y';
        } else {
          return;
        }
      }
      if (g.axis !== 'x' || g.ignored) return;

      if (e.cancelable) e.preventDefault();

      const now = performance.now();
      g.samples.push({ x: touch.clientX, t: now });
      // 只留最近 120ms 的采样，松手速度不受更早的拖动影响
      g.samples = g.samples.filter((sample) => now - sample.t <= 120);
      g.lastX = touch.clientX;

      const travel = Math.max(0, Math.abs(dx) - SWIPE_INTENT_PX);
      if (reduced || travel === 0) {
        dragX.set(0);
      } else {
        const atEdge = (index === 0 && dx > 0) || (index === PAGE_ORDER.length - 1 && dx < 0);
        dragX.set(Math.sign(dx) * travel * (atEdge ? 0.16 : 0.92));
      }
    }

    function onEnd() {
      const g = gesture.current;
      gesture.current = null;
      host!.style.willChange = '';
      if (!g) return;

      if (g.ignored || g.axis !== 'x') {
        if (!reduced) anim.current = animate(dragX, 0, spring.snappy);
        return;
      }

      // 用原始位移判定，不用带死区和边缘阻尼的视觉位移
      const step = decideSwipe({
        dx: g.lastX - g.startX,
        dy: 0,
        vx: swipeVelocity(g.samples, performance.now()),
      });
      const target = step === 0 ? undefined : PAGE_ORDER[index + step];
      if (target) {
        navigate(target);
        return;
      }
      if (!reduced) anim.current = animate(dragX, 0, spring.snappy);
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
