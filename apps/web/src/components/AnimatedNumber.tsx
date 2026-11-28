import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  /** 显示格式；默认取整 */
  format?: (value: number) => string;
  className?: string;
}

const DURATION = 420;

/**
 * 数字从旧值走到新值。换统计区间、补完一次训练后，主指标不再「啪」地跳变，
 * 而是让用户看见它变了多少。首屏不播放（初值即终点）。
 */
export function AnimatedNumber({ value, format = defaultFormat, className }: Props) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const shown = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    if (reduced) {
      shown.current = value;
      setDisplay(value);
      return;
    }
    const from = shown.current;
    if (from === value) return;

    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / DURATION);
      // ease-out cubic：一开始快，收尾慢，和项目里的弹簧方向一致
      const eased = 1 - (1 - progress) ** 3;
      const next = from + (value - from) * eased;
      shown.current = next;
      setDisplay(next);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, reduced]);

  return (
    <span className={className} aria-live="off">
      {format(display)}
    </span>
  );
}

function defaultFormat(value: number): string {
  return String(Math.round(value));
}
