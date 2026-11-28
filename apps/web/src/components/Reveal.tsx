import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { spring } from '../lib/motion';

interface Props {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** 「全部展开」这类批量操作直接落位，不逐块做高度动画 */
  instant?: boolean;
}

/**
 * 从无到有的小块内容：确认条、补记提示、自定义日期、肌群明细。
 *
 * 用高度 + 透明度交代「它从哪长出来」，而不是突然把下面的内容顶开。
 * 高度动画只该用于这种几十像素的小块；长列表、整页切换一律只用
 * transform / opacity，避免每帧重排。
 */
export function Reveal({ open, children, className, instant = false }: Props) {
  const reduced = useReducedMotion();
  /** 入场结束后放开裁剪，避免聚焦描边被 overflow 切掉；首挂即 open 时没有动画可等 */
  const [settled, setSettled] = useState(open);

  useEffect(() => {
    if (!open) setSettled(false);
    else if (reduced) setSettled(true);
  }, [open, reduced]);

  if (instant && open) {
    return (
      <div className={className} style={{ display: 'flow-root' }}>
        {children}
      </div>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <m.div
          className={className}
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={
            reduced
              ? { duration: 0 }
              : { height: spring.panel, opacity: { duration: 0.16 } }
          }
          style={{
            display: 'flow-root',
            overflow: settled ? 'visible' : 'hidden',
          }}
          onAnimationComplete={() => {
            if (open) setSettled(true);
          }}
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
