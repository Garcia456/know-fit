import { m, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { spring } from '../lib/motion';

export interface SegmentOption {
  key: string;
  label: string;
}

interface Props {
  options: readonly SegmentOption[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}

/**
 * 分段选择：白底滑块跟着选中项走，而不是每一项各自闪一下背景。
 * 统计页与有效组二级页共用，保证同一个控件在两处长得一样、动得一样。
 */
export function Segmented({ options, value, onChange, ariaLabel }: Props) {
  const reduced = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ x: 0, width: 0 });

  useLayoutEffect(() => {
    function measure() {
      const host = hostRef.current;
      const active = host?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!host || !active) return;
      setThumb({ x: active.offsetLeft, width: active.offsetWidth });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, options.length]);

  return (
    <div
      className="segmented"
      ref={hostRef}
      role="group"
      aria-label={ariaLabel}
      data-enhanced="true"
    >
      {thumb.width > 0 ? (
        <m.span
          className="segmented__thumb"
          aria-hidden="true"
          initial={false}
          animate={{ x: thumb.x, width: thumb.width }}
          transition={reduced ? { duration: 0 } : spring.snappy}
        />
      ) : null}
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`chip${value === option.key ? ' is-on' : ''}`}
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
