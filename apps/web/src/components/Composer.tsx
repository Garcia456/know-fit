import type { FormEvent, RefObject } from 'react';
import { SendIcon } from './Icons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function Composer({
  value,
  onChange,
  onSend,
  sending = false,
  placeholder = '记录训练，或问我动作和练法',
  inputRef,
}: Props) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSend();
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="pill">
        <input
          ref={inputRef}
          className="pill-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label="训练、饮食或提问"
          enterKeyHint="send"
        />
        <button
          type="submit"
          className="send"
          aria-label="发送"
          disabled={sending || !value.trim()}
        >
          {sending ? <span className="pill-sending">…</span> : <SendIcon />}
        </button>
      </div>
    </form>
  );
}