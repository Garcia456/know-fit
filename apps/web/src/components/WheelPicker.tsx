import { useEffect, useRef } from 'react';

export interface WheelColumn {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface Props {
  columns: WheelColumn[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

const ROW_FALLBACK = 44;

/** 滚轮列：上下滚动 / 点选 / 方向键；滚到哪格就选中哪格。 */
export function WheelPicker({ columns, values, onChange }: Props) {
  return (
    <div className="wheel">
      <span className="wheel__band" aria-hidden="true" />
      {columns.map((col) => (
        <WheelColumnView
          key={col.key}
          column={col}
          value={values[col.key] ?? ''}
          onChange={(v) => onChange(col.key, v)}
        />
      ))}
    </div>
  );
}

function WheelColumnView({
  column,
  value,
  onChange,
}: {
  column: WheelColumn;
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** 值来自滚动时不再往回纠偏，否则会和惯性滚动打架 */
  const fromScroll = useRef(false);
  const frame = useRef(0);

  useEffect(() => {
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const host = ref.current;
    const active = host?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!host || !active) return;
    // 只滚列自身，避免 scrollIntoView 把整页带跑
    const offset =
      active.getBoundingClientRect().top - host.getBoundingClientRect().top;
    host.scrollTop += offset - (host.clientHeight - active.offsetHeight) / 2;
  }, [value]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function handleScroll() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const host = ref.current;
      if (!host) return;
      const row = host.querySelector<HTMLElement>('.wheel__opt')?.offsetHeight || ROW_FALLBACK;
      const at = Math.round(host.scrollTop / row);
      const opt = column.options[Math.min(column.options.length - 1, Math.max(0, at))];
      if (opt && opt.value !== value) {
        fromScroll.current = true;
        onChange(opt.value);
      }
    });
  }

  function step(delta: number) {
    const at = column.options.findIndex((o) => o.value === value);
    const next = column.options[Math.min(column.options.length - 1, Math.max(0, at + delta))];
    if (next) onChange(next.value);
  }

  return (
    <div
      ref={ref}
      className="wheel__col"
      role="listbox"
      aria-label={column.label}
      tabIndex={0}
      onScroll={handleScroll}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          step(-1);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          step(1);
        }
      }}
    >
      {column.options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="option"
          aria-selected={opt.value === value}
          tabIndex={-1}
          className={`wheel__opt${opt.value === value ? ' is-on' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}