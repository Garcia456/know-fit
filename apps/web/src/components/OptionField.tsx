import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { ChevronDownIcon } from './Icons';

interface Props {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/** 选项字段：按钮触发底部列表，替代原生 select。 */
export function OptionField({ label, value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        type="button"
        className={`field field--select${current ? '' : ' is-empty'}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="field__value">{current?.label ?? '未填'}</span>
        <span className="field__chevron">
          <ChevronDownIcon />
        </span>
      </button>

      <BottomSheet open={open} title={label} onClose={() => setOpen(false)}>
        <ul className="sheet-list" role="listbox" aria-label={label}>
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`sheet-option${opt.value === value ? ' is-on' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}