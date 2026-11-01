/**
 * 平台可见性 —— 唯一判定点。
 * 受限平台必须逐用户判权；非受限平台全员可见。
 */
export const RESTRICTED_PLATFORMS = ['douyin'] as const;

/** 无风险知识库：当前为空（库里只有抖音源）。加自有版权来源时放这里。 */
export const UNRESTRICTED_PLATFORMS: readonly string[] = [];

/** 纯函数：非受限平台 ∪ 该用户被授权的受限平台，去重 */
export function visiblePlatforms(granted: readonly string[]): string[] {
  return [...new Set([...UNRESTRICTED_PLATFORMS, ...granted])];
}