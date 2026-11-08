import { useRef, useState, type ReactNode } from 'react';

interface Props {
  /** 浮出的说明文字 */
  text: string;
  /** 贴着右边缘时改成向右对齐，免得被页面裁掉 */
  align?: 'start' | 'end';
  /** 由外部收起（比如菜单已经展开） */
  hidden?: boolean;
  children: ReactNode;
}

/** 悬停或键盘聚焦浮出白底小提示，外观与推测提示同一套 */
export function Tip({ text, align = 'start', hidden = false, children }: Props) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  /** 刚按下指针：随后的聚焦不算键盘聚焦 */
  const pointerRef = useRef(false);
  const open = !hidden && (hover || focused);

  return (
    <span
      className="tip-wrap"
      // 触屏直接点，不弹悬停提示
      onPointerEnter={(e) => {
        if (e.pointerType !== 'touch') setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
      onPointerDown={() => {
        pointerRef.current = true;
        setHover(false);
      }}
      // 只在键盘聚焦时浮出：鼠标点完按钮不留下提示
      onFocus={() => {
        if (!pointerRef.current) setFocused(true);
        pointerRef.current = false;
      }}
      onBlur={() => setFocused(false)}
    >
      {children}
      {open ? (
        <span className={align === 'end' ? 'tip tip--end' : 'tip'} role="tooltip">
          {text}
        </span>
      ) : null}
    </span>
  );
}
