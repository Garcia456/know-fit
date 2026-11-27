import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { duration, spring } from '../lib/motion';
import { CloseIcon } from './Icons';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** 居中卡片弹层：portal 到 body，遮罩模糊背景；关闭后焦点回到触发按钮。 */
export function BottomSheet({ open, title, onClose, children }: Props) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    document.body.classList.add('sheet-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // 焦点落到弹层本身，而不是碰巧排在前面的关闭按钮
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      returnFocus.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <m.div
          className="sheet-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : duration.base }}
        >
          <button type="button" className="sheet-mask" aria-label="关闭" onClick={onClose} />
          <m.div
            ref={panelRef}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={reduced ? false : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
            transition={reduced ? { duration: 0 } : spring.panel}
          >
            <div className="sheet-hd">
              <h2>{title}</h2>
              <button type="button" className="sheet-cancel" aria-label="取消" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
            {children}
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}