import type { BackfillPrompt } from '../api/types';
import { formatRelativeDay } from '../lib/format';

interface Props {
  prompt: BackfillPrompt;
  busy?: boolean;
  onAction: (action: '补记' | '休息' | '忽略') => void;
}

/** 记录完今天后，卡片下的「补昨天」提示。 */
export function BackfillPromptView({ prompt, busy = false, onAction }: Props) {
  const day = formatRelativeDay(prompt.target_date);
  const mentioned = prompt.source === 'mentioned' && prompt.split_label;

  return (
    <section className="backfill" aria-label="补记提示">
      <p className="backfill__text">
        {mentioned
          ? `你${day}提到练了${prompt.split_label}，但${day}没有记录。要补上吗？`
          : `${day}没有训练记录。是休息，还是练了没记？`}
      </p>
      <div className="backfill__actions">
        <button type="button" disabled={busy} onClick={() => onAction('补记')}>
          {mentioned ? `补记${day}` : '练了没记'}
        </button>
        <button type="button" disabled={busy} onClick={() => onAction('休息')}>
          {mentioned ? '这天休息' : '休息'}
        </button>
        <button type="button" disabled={busy} onClick={() => onAction('忽略')}>
          先不用
        </button>
      </div>
    </section>
  );
}
