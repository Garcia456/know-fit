import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronDownIcon } from './Icons';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  above: boolean;
}

const MENU_WIDTH = 240;
const VIEWPORT_GAP = 12;
const TRIGGER_GAP = 6;

/** 自绘下拉：portal 浮层不会被子卡片的 overflow 裁掉。 */
export function SelectField({ label, value, options, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openMenu = useCallback(() => {
    if (disabled) return;
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  }, [disabled, selectedIndex]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(180, Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_GAP * 2));
    const left = Math.max(
      VIEWPORT_GAP,
      Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_GAP),
    );
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const above =
      rect.bottom + TRIGGER_GAP + menuHeight > window.innerHeight - VIEWPORT_GAP &&
      rect.top - TRIGGER_GAP - menuHeight >= VIEWPORT_GAP;
    const top = above
      ? rect.top - TRIGGER_GAP - menuHeight
      : Math.min(rect.bottom + TRIGGER_GAP, window.innerHeight - VIEWPORT_GAP);
    setPosition({ top, left, width, above });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, options.length, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [closeMenu, open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const option = menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    option?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  function commit(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeMenu(true);
  }

  function moveActive(delta: number) {
    setActiveIndex((index) => Math.min(options.length - 1, Math.max(0, index + delta)));
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  const menu = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={`select-field__menu${position?.above ? ' select-field__menu--above' : ''}`}
          style={
            position
              ? { top: position.top, left: position.left, width: position.width }
              : { top: -9999, left: -9999, width: MENU_WIDTH }
          }
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <div
                key={option.value}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={selected}
                data-index={index}
                className={[
                  'select-field__option',
                  selected ? 'is-selected' : '',
                  activeIndex === index ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
              >
                <span className="select-field__option-copy">
                  <span className="select-field__option-label">{option.label}</span>
                  {option.description ? (
                    <span className="select-field__option-description">{option.description}</span>
                  ) : null}
                </span>
                {selected ? (
                  <span className="select-field__check" aria-hidden="true">
                    <CheckIcon size={15} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={rootRef} className={`select-field${open ? ' is-open' : ''}`} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="select-field__trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
      >
        <span className="select-field__value">{current?.label ?? '未填'}</span>
        <span className="select-field__chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>
      {menu}
    </div>
  );
}
