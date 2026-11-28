import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { duration } from '../lib/motion';

interface Props {
  /** 浮出的说明文字 */
  text: string;
  /** 贴着右边缘时改成向右对齐，免得被页面裁掉 */
  align?: 'start' | 'end';
  /** 由外部收起（比如菜单已经展开） */
  hidden?: boolean;
  children: ReactNode;
}

/** 悬停 450ms 或键盘聚焦才浮出白底小提示，外观与推测提示同一套 */
export function Tip({ text, align = 'start', hidden = false, children }: Props) {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  /** 刚按下指针：随后的聚焦不算键盘聚焦 */
  const pointerRef = useRef(false);
  const hoverTimer = useRef(0);
  const open = !hidden && (hover || focused);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  function clearHover() {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = 0;
    setHover(false);
  }

  return (
    <span
      className="tip-wrap"
      // 悬停要等一拍再出现：按钮换位后指针恰好落在新按钮上时，不该立刻弹说明
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return;
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setHover(true), 450);
      }}
      onPointerLeave={clearHover}
      onPointerDown={() => {
        pointerRef.current = true;
        clearHover();
      }}
      // 只在键盘聚焦时浮出：鼠标点完按钮不留下提示
      onFocus={() => {
        if (!pointerRef.current) setFocused(true);
        pointerRef.current = false;
      }}
      onBlur={() => setFocused(false)}
    >
      {children}
      <AnimatePresence>
        {open ? (
          <m.span
            className={align === 'end' ? 'tip tip--end' : 'tip'}
            role="tooltip"
            initial={reduced ? false : { opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -2 }}
            transition={{ duration: reduced ? 0 : duration.fast }}
          >
            {text}
          </m.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
