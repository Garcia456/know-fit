import type { Transition } from 'motion/react';

/**
 * 全项目共用的一套动效参数。同一类变化 —— 抽屉、弹层、页签、列表让位 ——
 * 都从这里取，避免每处自己发明曲线和时长。
 *
 * 原则：快、轻、可打断。弹簧只用 transform / opacity；高度动画只给
 * 真正需要交代「从哪里长出来」的小块内容（见 Reveal）。
 */
export const spring = {
  /** 按钮、页签、小范围位移：收得干脆，不拖泥带水 */
  snappy: { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 },
  /** 面板、卡片入场：比 snappy 软一档 */
  panel: { type: 'spring', stiffness: 460, damping: 38, mass: 0.9 },
  /** 抽屉：面积大，稍微再稳一点 */
  drawer: { type: 'spring', stiffness: 420, damping: 42, mass: 0.9 },
} satisfies Record<string, Transition>;

export const easeOut = [0.22, 1, 0.36, 1] as const;
export const easeInOut = [0.65, 0, 0.35, 1] as const;

/** 秒；和 styles.css 里的 --dur-* 保持同一组节奏 */
export const duration = {
  fast: 0.14,
  base: 0.22,
  slow: 0.3,
} as const;
