/** 四个主路由的顺序；左右滑按这个顺序换页。 */
export const PAGE_ORDER = ['/', '/stats', '/data', '/profile'] as const;

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