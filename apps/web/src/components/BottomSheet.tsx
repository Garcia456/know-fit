import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { lockAppRoot, trapTab } from '../lib/dialogFocus';
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
  const unlockRef = useRef<(() => void) | null>(null);
  const openRef = useRef(open);
  /** 父组件每次滚动 / 选值都会重建 onClose；放进 ref，避免把焦点从滚轮上抢回来 */
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
    openRef.current = open;
  });

  useEffect(() => {
    if (!open) return;
    if (!unlockRef.current) unlockRef.current = lockAppRoot();
    returnFocus.current = document.activeElement as HTMLElement | null;
    document.body.classList.add('sheet-open');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      trapTab(e, panelRef.current);
    };
    document.addEventListener('keydown', onKey);
    // 焦点落到弹层本身，而不是碰巧排在前面的关闭按钮
    panelRef.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(
    () => () => {
      unlockRef.current?.();
      unlockRef.current = null;
      document.body.classList.remove('sheet-open');
      returnFocus.current?.focus?.({ preventScroll: true });
    },
    [],
  );

  function finishExit() {
    if (openRef.current) return;
    unlockRef.current?.();
    unlockRef.current = null;
    document.body.classList.remove('sheet-open');
    returnFocus.current?.focus?.({ preventScroll: true });
    returnFocus.current = null;
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence onExitComplete={finishExit}>
      {open ? (
        <m.div
          className="sheet-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : duration.base }}
        >
          <button type="button" className="sheet-mask" aria-label="关闭" onClick={onCloseRef.current} />
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
              <button
                type="button"
                className="sheet-cancel"
                aria-label="取消"
                onClick={() => onCloseRef.current()}
              >
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
