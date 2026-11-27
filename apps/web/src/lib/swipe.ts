/** 四个主路由的顺序；左右滑按这个顺序换页。 */
export const PAGE_ORDER = ['/', '/stats', '/data', '/profile'] as const;

/**
 * 手指先横着走这么远，页面才开始跟手。
 * 不设死区的话，任何一点斜向滚动都会把整页横着推开再弹回去 ——
 * 用户看到的是「界面自己挪了一下」，而不是「我在翻页」。
 */
export const SWIPE_INTENT_PX = 18;

/** 慢速拖动跨过这个距离就换页。 */
const SWIPE_COMMIT_PX = 64;

/** 快速轻甩：距离不必很长，但速度要够。 */
const SWIPE_FLICK_PX = 24;
const SWIPE_FLICK_VELOCITY = 380;

/**
 * 路径 → 主路由下标。二级页（如 /stats/hard-sets）归到它所属的主页，
 * 避免 index 变成 -1、滑入方向判错。
 */
export function pageIndexOf(pathname: string): number {
  if (pathname.startsWith('/stats/')) return PAGE_ORDER.indexOf('/stats');
  return PAGE_ORDER.indexOf(pathname as (typeof PAGE_ORDER)[number]);
}

/** 二级页不做左右翻页，只保留主路由的滑动手势。 */
export function isSubpage(pathname: string): boolean {
  return pathname.startsWith('/stats/');
}

export type SwipeDecision = -1 | 0 | 1;

/**
 * 横向滑动是否要换页：-1 上一页 / 1 下一页 / 0 不动。
 *
 * 三种情况放行：拖得够远；或者距离不长但甩得够快；或者两者之间。
 * 快速轻甩必须算数 —— 否则用户小幅度快滑会看到页面挪动又弹回，
 * 却始终不换页，这正是「划得小只会晃、划得大才切页」的来源。
 */
export function decideSwipe(input: { dx: number; dy: number; vx: number }): SwipeDecision {
  const { dx, dy, vx } = input;
  const distance = Math.abs(dx);
  if (distance <= Math.abs(dy)) return 0;
  if (distance < SWIPE_FLICK_PX) return 0;

  // 松手前已经往回拉了：以最后的方向为准，不换页
  if (vx !== 0 && Math.sign(vx) !== Math.sign(dx) && Math.abs(vx) > 200) return 0;

  if (distance >= SWIPE_COMMIT_PX) return dx < 0 ? 1 : -1;
  if (distance >= SWIPE_FLICK_PX && Math.abs(vx) >= SWIPE_FLICK_VELOCITY) {
    return dx < 0 ? 1 : -1;
  }
  return 0;
}
