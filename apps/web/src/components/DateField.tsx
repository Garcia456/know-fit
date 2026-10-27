import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { WheelPicker } from './WheelPicker';

interface Props {
  label: string;
  value: string;
  max?: string;
  /** 滚轮最早一年；生日要往前排几十年，默认按统计筛选的 2000 起 */
  minYear?: number;
  /** 没值时滚轮停在哪天，默认今天 */
  defaultValue?: string;
  /** 行内只显示值 + ▾，与训练年限同一套外观 */
  compact?: boolean;
  onChange: (value: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parse(value: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? { y, m, d } : null;
}

function today(): { y: number; m: number; d: number } {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/** 日期字段：按钮触发底部滚轮（年 / 月 / 日），不再用原生 date 输入。 */
export function DateField({
  label,
  value,
  max,
  minYear,
  defaultValue,
  compact,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const { y, m, d } = parse(draft) ?? parse(defaultValue ?? '') ?? today();

  const lastYear = max ? Number(max.slice(0, 4)) : new Date().getFullYear();
  const firstYear = minYear ?? 2000;
  const years = Array.from({ length: Math.max(1, lastYear - firstYear + 1) }, (_, i) => lastYear - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1);

  function fallbackDate(): string {
    const p = parse(defaultValue ?? '') ?? today();
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }

  function openSheet() {
    // 没值时滚轮也得有个落点，确认后拿到的就是这个日期
    setDraft(value || fallbackDate());
    setOpen(true);
  }

  function setPart(key: string, raw: string) {
    const next = { y, m, d, [key]: Number(raw) };
    const day = Math.min(next.d, daysInMonth(next.y, next.m));
    setDraft(`${next.y}-${pad(next.m)}-${pad(day)}`);
  }

  function confirm() {
    const picked = max && draft > max ? max : draft;
    onChange(picked);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className={
          compact
            ? `field field--select${value ? '' : ' is-empty'}`
            : `field${value ? '' : ' is-empty'}`
        }
        aria-label={compact ? `${label}日期` : `${label}日期${value ? ` ${value}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openSheet}
      >
        {compact ? (
          <>
            <span className="field__value">{value || '未填'}</span>
            <span className="field__chevron" aria-hidden="true">
              ▾
            </span>
          </>
        ) : (
          <>
            <span className="field__label">{label}</span>
            <span className="field__value">{value || '选择日期'}</span>
          </>
        )}
      </button>

      <BottomSheet open={open} title={`选择${label}日期`} onClose={() => setOpen(false)}>
        <WheelPicker
          columns={[
            {
              key: 'y',
              label: '年',
              options: years.map((n) => ({ value: String(n), label: `${n}年` })),
            },
            {
              key: 'm',
              label: '月',
              options: months.map((n) => ({ value: String(n), label: `${n}月` })),
            },
            {
              key: 'd',
              label: '日',
              options: days.map((n) => ({ value: String(n), label: `${n}日` })),
            },
          ]}
          values={{ y: String(y), m: String(m), d: String(d) }}
          onChange={setPart}
        />
        <div className="sheet-actions">
          {compact ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              未填
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
              取消
            </button>
          )}
          <button type="button" className="btn" onClick={confirm}>
            确定
          </button>
        </div>
      </BottomSheet>
    </>
  );
}