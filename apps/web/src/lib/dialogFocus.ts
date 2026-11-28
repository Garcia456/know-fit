/**
 * 弹窗焦点与背景锁的共用小工具。
 *
 * - 只在弹窗内部循环 Tab，`aria-modal` 才不会名不副实；
 * - 背景用 inert 锁住，屏幕阅读器和键盘都到不了遮罩后面；
 * - 锁的释放交给退出动画完成，不在 open=false 的那一帧就把背景放出来。
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0,
  );
}

/** 在弹窗内循环 Tab；没有可聚焦项时把焦点留在面板上 */
export function trapTab(event: KeyboardEvent, root: HTMLElement | null): void {
  if (event.key !== 'Tab' || !root) return;
  const items = focusables(root);
  if (items.length === 0) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || !root.contains(active)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    }
  } else if (active === last || !root.contains(active)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

/** 背景锁可以叠加：两个弹窗先后打开时，只由最后一个释放 */
let lockCount = 0;

export function lockAppRoot(): () => void {
  lockCount += 1;
  const root = document.getElementById('root');
  root?.setAttribute('inert', '');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) root?.removeAttribute('inert');
  };
}
