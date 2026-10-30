import type { VolumeHook } from '../api/types';
import { verdictSentence } from '../lib/verdict';

interface Props {
  hook: VolumeHook;
  onAssess?: () => void;
  assessing?: boolean;
}

/** 数据钩子：记录完成后带一个已算好的判定，可顺着进评估。 */
export function VolumeHookView({ hook, onAssess, assessing }: Props) {
  return (
    <section className="hook" aria-label="数据钩子">
      <div className="hook-hd">
        <div className="grow">
          <p className="eyebrow">数据钩子</p>
          <p className="hook-claim">{verdictSentence(hook)}</p>
          <p className="hook-sub">判定由确定性代码算出，不经模型改写</p>
        </div>
      </div>
      {onAssess ? (
        <div className="hook-ask-row">
          <p className="hook-ask">要不要看看这次练得够不够？</p>
          <button type="button" className="text-action" onClick={onAssess} disabled={assessing}>
            {assessing ? '正在评估…' : '看这次评估'}
          </button>
        </div>
      ) : null}
    </section>
  );
}