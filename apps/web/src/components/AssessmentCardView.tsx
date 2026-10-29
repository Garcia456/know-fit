import type { AssessmentCard, Citation } from '../api/types';
import { numberClaims } from '../lib/citations';
import { formatCitationTs } from '../lib/format';
import { verdictSentence } from '../lib/verdict';
import { ChartIcon, ChevronRightIcon, InfoIcon, LinkIcon } from './Icons';

/** 评估卡：有源 / 无源靠标签 + 结构区分，不只靠颜色。 */
export function AssessmentCardView({ card }: { card: AssessmentCard }) {
  const claims = numberClaims(card.advice_claims, card.citations);

  return (
    <article className="card" aria-label="评估结果">
      <div className="card-hd">
        <ChartIcon />
        <h3>评估</h3>
        <span className={card.has_source ? 'tag' : 'tag tag--dashed'}>
          {card.has_source ? '有来源' : '无来源'}
        </span>
      </div>

      <div className="verdict">
        <p>{verdictSentence(card.verdict)}</p>
        <span>判定由确定性代码算出，不经模型改写</span>
      </div>

      {claims.length > 0 ? (
        <ol className="advice">
          {claims.map((item, i) => {
            const citation =
              item.basis === 'source' && item.number
                ? card.citations[item.number - 1]
                : undefined;
            return (
              <li key={`${i}-${item.claim}`}>
                <span className="num">{i + 1}</span>
                <div className="adv-body">
                  <p className="adv">{item.claim}</p>
                  {citation ? (
                    <SourceBlock citation={citation} />
                  ) : item.basis === 'source' && card.has_source ? (
                    <div className="nosrc">
                      <InfoIcon />
                      <p>这条建议的出处没对上引用列表 —— 按通用知识看</p>
                    </div>
                  ) : (
                    <div className="nosrc">
                      <InfoIcon />
                      <p>这条没有找到对应的博主内容 —— 由 AI 通用知识生成</p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="adv">{card.advice}</p>
      )}

      <p className="foot-note">
        {card.no_source_notice ??
          '判定来自你的数据；建议基于检索到的博主内容，可点回原片自己判断。'}
      </p>
    </article>
  );
}

export function SourceBlock({ citation }: { citation: Citation }) {
  // 不足 1 秒的起点没有定位意义，整块时间标签不渲染
  const ts = formatCitationTs(citation.start_ts);
  return (
    <div className="src">
      <div className="src-top">
        <LinkIcon />
        <span className="who">{citation.creator}</span>
        <span className="dot">·</span>
        <span className="vt">{citation.title}</span>
      </div>
      <div className="src-bot">
        {ts ? <span className="ts">{ts}</span> : null}
        <a
          className="go"
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          aria-label={ts ? `看原片 ${ts}` : '看原片'}
        >
          看原片
          <ChevronRightIcon size={13} />
        </a>
      </div>
    </div>
  );
}