import { ChartIcon, InfoIcon } from './Icons';

const MISSING_ROW: Record<string, { name: string; hint: string }> = {
  sets: { name: '有效组', hint: '这次还没记录正式组' },
  split_label: { name: '训练部位', hint: '这次没标推日 / 背日' },
  baseline: { name: '上一次同类训练', hint: '还没有可对比的基准' },
};

interface Props {
  missing: string[];
  onComplete?: () => void;
}

/** 判定算不出来时：只说缺什么，不给建议。 */
export function LowDataCard({ missing, onComplete }: Props) {
  const rows = missing.map((key) => MISSING_ROW[key] ?? { name: key, hint: '还缺这一项' });

  return (
    <article className="card" aria-label="数据不足">
      <div className="card-hd">
        <ChartIcon />
        <h3>暂时算不出判定</h3>
        <span className="tag tag--dashed">数据不足</span>
      </div>
      <div className="verdict">
        <p>还差 {rows.length} 项才能算趋势</p>
        <span>判定要有效组、训练部位、上一次同类训练都齐了才成立。</span>
      </div>
      <dl className="ex-list" style={{ marginTop: 14 }}>
        {rows.map((row) => (
          <div key={row.name} className="ex-row is-missing">
            <dt>{row.name}</dt>
            <dd>{row.hint}</dd>
            <span className="val">待补</span>
          </div>
        ))}
      </dl>
      <div className="note-inline">
        <InfoIcon />
        <p>缺数据时我只说明缺什么，不给建议 —— 硬给就是在猜。</p>
      </div>
      {onComplete ? (
        <div className="ask">
          <p>补完就能算趋势</p>
          <button type="button" className="text-action" onClick={onComplete}>
            补记这次训练
          </button>
        </div>
      ) : null}
    </article>
  );
}