import { useState } from 'react';
import { formatTraining } from '../lib/profile';
import { BottomSheet } from './BottomSheet';
import { ChevronDownIcon } from './Icons';
import { WheelPicker } from './WheelPicker';

interface Props {
  years: number | null;
  months: number | null;
  onChange: (years: number | null, months: number | null) => void;
}

const YEAR_MAX = 50;
const YEARS = Array.from({ length: YEAR_MAX + 1 }, (_, i) => i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i);

/** 训练年限：年 + 月两个滚轮，可清空。 */
export function TrainingField({ years, months, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ y: years ?? 0, m: months ?? 0 });

  function openSheet() {
    setDraft({ y: years ?? 0, m: months ?? 0 });
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        className={`field field--select${years === null ? ' is-empty' : ''}`}
        aria-label="训练年限"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openSheet}
      >
        <span className="field__value">{formatTraining(years, months)}</span>
        <span className="field__chevron">
          <ChevronDownIcon />
        </span>
      </button>

      <BottomSheet open={open} title="训练年限" onClose={() => setOpen(false)}>
        <WheelPicker
          columns={[
            {
              key: 'y',
              label: '年',
              options: YEARS.map((n) => ({ value: String(n), label: `${n} 年` })),
            },
            {
              key: 'm',
              label: '月',
              options: MONTHS.map((n) => ({ value: String(n), label: `${n} 个月` })),
            },
          ]}
          values={{ y: String(draft.y), m: String(draft.m) }}
          onChange={(key, value) =>
            setDraft((prev) =>
              key === 'y' ? { ...prev, y: Number(value) } : { ...prev, m: Number(value) },
            )
          }
        />
        <div className="sheet-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              onChange(null, null);
              setOpen(false);
            }}
          >
            未填
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onChange(draft.y, draft.m);
              setOpen(false);
            }}
          >
            确定
          </button>
        </div>
      </BottomSheet>
    </>
  );
}