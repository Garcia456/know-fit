import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { SendIcon } from './Icons';

/** 输入框最高高度；超过后框内滚动 */
const MAX_HEIGHT = 132;
/** 单行高度：超过它就是多行，胶囊换成小圆角矩形 */
const LINE_HEIGHT = 22;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({
  value,
  onChange,
  onSend,
  sending = false,
  placeholder = '记录训练，或问我动作和练法',
  inputRef,
}: Props) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [multiline, setMultiline] = useState(false);

  // 内容变化后按 scrollHeight 长高；封顶后改为框内滚动
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // 页面被隐藏时量不到高度，显示后由挂载重新计算
    if (el.scrollHeight === 0) return;
    const height = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${height}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';

    // scrollHeight 含上下 padding，先减掉再除以行高才是行数
    const cs = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(cs.lineHeight) || LINE_HEIGHT;
    const padY =
      (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0);
    const lines = Math.max(1, Math.round((el.scrollHeight - padY) / lineHeight));
    setMultiline(lines > 1);
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') return;
    // 中文输入法候选态的回车不发送
    if (event.nativeEvent.isComposing) return;
    if (event.shiftKey) return;
    // 触屏没有 Shift：回车留给换行，发送走按钮
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    event.preventDefault();
    onSend();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSend();
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className={multiline ? 'pill pill--multi' : 'pill'}>
        <textarea
          ref={(el) => {
            areaRef.current = el;
            if (inputRef) inputRef.current = el;
          }}
          className="pill-input"
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="训练、饮食或提问"
          enterKeyHint="enter"
        />
        <button
          type="submit"
          className="send"
          aria-label="发送"
          disabled={sending || !value.trim()}
        >
          <SendIcon />
        </button>
      </div>
    </form>
  );
}