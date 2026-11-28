import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { focusables, lockAppRoot, trapTab } from '../lib/dialogFocus';
import { duration, spring } from '../lib/motion';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 关闭后焦点回到哪里；默认回到打开前的 activeElement */
  returnFocus?: HTMLElement | null;
  /** 提交中：按钮可能全部 disabled，焦点不能掉到遮罩后面 */
  busy?: boolean;
}

/**
 * 居中弹窗：遮罩淡入、面板从下方轻轻就位；关闭时原路退回。
 * 会话改名 / 删除都走这一处，保证同一种「打断」长得一样。
 */
export function Modal({ open, title, onClose, children, returnFocus, busy = false }: Props) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusProp = useRef<HTMLElement | null>(returnFocus);
  const unlockRef = useRef<(() => void) | null>(null);
  const openRef = useRef(open);
  /** 父组件每次渲染都会传新的 onClose；放进 ref，避免弹窗里的输入被反复重新聚焦 */
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
    returnFocusProp.current = returnFocus;
    openRef.current = open;
  });

  useEffect(() => {
    if (!open) return;
    // 背景锁和退出动画配对释放；快速重开时不要重复加锁
    if (!unlockRef.current) unlockRef.current = lockAppRoot();
    returnFocusRef.current =
      returnFocusProp.current ?? (document.activeElement as HTMLElement | null);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      trapTab(event, panelRef.current);
    };
    document.addEventListener('keydown', onKey);

    const first = focusables(panelRef.current)[0] ?? panelRef.current;
    first?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // 提交中按钮全部 disabled 时，浏览器会把焦点丢掉；把焦点留在面板上
  useEffect(() => {
    if (!open || !busy) return;
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus({ preventScroll: true });
    }
  }, [open, busy]);

  useEffect(
    () => () => {
      unlockRef.current?.();
      unlockRef.current = null;
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    },
    [],
  );

  function finishExit() {
    if (openRef.current) return;
    unlockRef.current?.();
    unlockRef.current = null;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence onExitComplete={finishExit}>
      {open ? (
        <m.div
          className="modal-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : duration.base }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onCloseRef.current();
          }}
        >
          <m.div
            ref={panelRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduced ? false : { opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={reduced ? { duration: 0 } : spring.panel}
          >
            <h2 id={titleId}>{title}</h2>
            {children}
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
