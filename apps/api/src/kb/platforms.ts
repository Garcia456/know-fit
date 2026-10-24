/**
 * 可见平台 —— ADR-026 的结构留位。
 * v1 无鉴权，一律放行抖音；接鉴权时只改这一个函数。
 */
export const V1_PLATFORMS = ['douyin'] as const;

export function visiblePlatforms(): string[] {
  return [...V1_PLATFORMS];
}
