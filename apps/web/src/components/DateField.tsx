import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { WheelPicker } from './WheelPicker';

interface Props {
  label: string;
  value: string;
  max?: string;
  onChange: (value: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parts(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }
  return { y, m, d };
}

/** 日期字段：按钮触发底部滚轮（年 / 月 / 日），不再用原生 date 输入。 */
export function DateField({ label, value, max, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const { y, m, d } = parts(draft);

  const lastYear = max ? Number(max.slice(0, 4)) : new Date().getFullYear();
  const years = Array.from({ length: lastYear - 1999 }, (_, i) => lastYear - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1);

  function openSheet() {
    setDraft(value);
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
        className={`field${value ? '' : ' is-empty'}`}
        aria-label={`${label}日期${value ? ` ${value}` : ''}`}
        onClick={openSheet}
      >
        <span className="field__label">{label}</span>
        <span className="field__value">{value || '选择日期'}</span>
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
          <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
            取消
          </button>
          <button type="button" className="btn" onClick={confirm}>
            确定
          </button>
        </div>
      </BottomSheet>
    </>
  );
}