import type { KnowledgeCard } from '../api/types';
import { InfoIcon } from './Icons';
import { SourceBlock } from './AssessmentCardView';

/** 知识回答：有源挂出处，无源显式标注 —— 不暗示有来源。 */
export function KnowledgeCardView({ card }: { card: KnowledgeCard }) {
  const citations = new Map(card.citations.map((c) => [c.citation_id, c]));

  return (
    <article className="card" aria-label="知识回答">
      <div className="card-hd">
        <InfoIcon />
        <h3>知识回答</h3>
        <span className={card.has_source ? 'tag' : 'tag tag--dashed'}>
          {card.has_source ? '有来源' : '无来源'}
        </span>
      </div>

      {card.claims.length > 0 ? (
        <ol className="advice">
          {card.claims.map((item, i) => {
            const citation = item.citation_id ? citations.get(item.citation_id) : undefined;
            return (
              <li key={`${i}-${item.claim}`}>
                <span className="num">{i + 1}</span>
                <div className="adv-body">
                  <p className="adv">{item.claim}</p>
                  {citation ? <SourceBlock citation={citation} /> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="adv">{card.answer}</p>
      )}

      <p className="foot-note">
        {card.no_source_notice ??
          '回答基于检索到的博主内容，可点回原片自己判断。'}
      </p>
    </article>
  );
}