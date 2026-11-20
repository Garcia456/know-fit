/** 四个主路由的顺序；左右滑按这个顺序换页。 */
export const PAGE_ORDER = ['/', '/stats', '/data', '/profile'] as const;

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
 * 纵向位移更大、位移太短且速度不够，都不算。
 */
export function decideSwipe(input: { dx: number; dy: number; vx: number }): SwipeDecision {
  const { dx, dy, vx } = input;
  if (Math.abs(dx) < 48) return 0;
  if (Math.abs(dx) <= Math.abs(dy)) return 0;
  if (Math.abs(dx) < 72 && Math.abs(vx) < 300) return 0;
  return dx < 0 ? 1 : -1;
}