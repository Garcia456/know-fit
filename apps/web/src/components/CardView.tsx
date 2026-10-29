import type {
  CorrectionCard,
  MealCard,
  MealType,
  MissingField,
  TurnCard,
  WeightCard,
  WorkoutCard,
  WorkoutCardExercise,
} from '../api/types';
import { describeSets, exerciseName, isMissingValue } from '../lib/exercise';
import { formatKg, formatMonthDay } from '../lib/format';
import { CheckIcon, InfoIcon, RefreshIcon, WarnIcon } from './Icons';
import { VolumeHookView } from './VolumeHookView';
import { KnowledgeCardView } from './KnowledgeCardView';

const MISSING_LABEL: Record<MissingField, string> = {
  exercises: '动作',
  reps: '次数',
  weight_kg: '重量',
};

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

interface Props {
  card: TurnCard;
  onAssess?: (sessionId: string) => void;
  assessingSessionId?: string | null;
  onComplete?: (sessionId: string) => void;
  onQuickAsk?: (message: string) => void;
}

export function CardView({ card, onAssess, assessingSessionId, onComplete, onQuickAsk }: Props) {
  switch (card.kind) {
    case 'workout':
      return (
        <WorkoutCardView
          card={card}
          onAssess={onAssess}
          assessing={assessingSessionId === card.session_id}
          onComplete={onComplete}
        />
      );
    case 'meal':
      return <MealCardView card={card} />;
    case 'chat':
      return <p className="agent-text">{card.reply}</p>;
    case 'knowledge':
      return <KnowledgeCardView card={card} />;
    case 'refusal':
      return <RefusalCardView reply={card.reply} onQuickAsk={onQuickAsk} />;
    case 'boundary':
      return (
        <article className="card" aria-label="使用范围提示">
          <div className="card-hd">
            <InfoIcon />
            <h3>这条超出我的范围</h3>
          </div>
          <div className="verdict">
            <p>{card.reply}</p>
            <span>未成年、有基础疾病或训练不足 3 个月时，这里只给通用建议</span>
          </div>
          <div className="note-inline">
            <InfoIcon />
            <p>这条对话不会记进训练记录，也不参与容量计算。</p>
          </div>
        </article>
      );
    case 'correction':
      return <CorrectionCardView card={card} />;
    case 'weight':
      return <WeightCardView card={card} />;
  }
}

function WeightCardView({ card }: { card: WeightCard }) {
  return (
    <article className="card" aria-label="体重记录">
      <div className="card-hd">
        <CheckIcon />
        <h3>体重已记录</h3>
        <span className="tag">{formatMonthDay(card.date)}</span>
      </div>
      <div className="sum">
        <span>当天体重</span>
        <b>{formatKg(card.weight_kg)}</b>
      </div>
    </article>
  );
}

function ExerciseRows({ exercises }: { exercises: WorkoutCardExercise[] }) {
  return (
    <dl className="ex-list">
      {exercises.map((exercise, i) => (
        <div
          key={`${i}-${exercise.raw_name}`}
          className={`ex-row${isMissingValue(exercise) ? ' is-missing' : ''}`}
        >
          <dt>{exerciseName(exercise)}</dt>
          <dd>{describeSets(exercise)}</dd>
          <span className="val">{formatKg(exercise.volume_kg)}</span>
        </div>
      ))}
    </dl>
  );
}

function WorkoutCardView({
  card,
  onAssess,
  assessing,
  onComplete,
}: {
  card: WorkoutCard;
  onAssess?: (sessionId: string) => void;
  assessing: boolean;
  onComplete?: (sessionId: string) => void;
}) {
  const incomplete = card.status === 'incomplete';
  const uncertainNames = card.exercises.filter((e) => e.name_confidence === 'low').length;

  return (
    <article className="card" aria-label="训练记录">
      <div className="card-hd">
        <CheckIcon />
        <h3>训练已记录</h3>
        <span className={incomplete ? 'tag tag--dashed' : 'tag'}>
          {incomplete ? '信息不全' : '已记完'}
        </span>
      </div>
      <p className="card-meta">
        {formatMonthDay(card.date)} · {card.split_label ?? '未标 split'} ·{' '}
        {card.exercises.length} 个动作
        {uncertainNames > 0 ? ` · ${uncertainNames} 个名称待确认` : ''}
      </p>
      <hr className="hr" />

      <ExerciseRows exercises={card.exercises} />

      <div className="sum">
        <span>合计（正式组）</span>
        <b>
          {card.working_sets} 组 · {formatKg(card.volume_kg)}
        </b>
      </div>

      {incomplete ? (
        <div className="ask">
          <p>
            还缺：{card.missing_fields.map((f) => MISSING_LABEL[f]).join(' / ')}
            —— 补上这几项，容量才准
          </p>
          {onComplete ? (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onComplete(card.session_id)}
            >
              补充漏掉的组
            </button>
          ) : null}
        </div>
      ) : null}

      {card.note ? <p className="card-meta">备注：{card.note}</p> : null}

      {card.hook ? (
        <div style={{ marginTop: 12 }}>
          <VolumeHookView
            hook={card.hook}
            onAssess={onAssess ? () => onAssess(card.session_id) : undefined}
            assessing={assessing}
          />
        </div>
      ) : onAssess && !incomplete ? (
        <div className="ask">
          <p>要不要看看这次练得够不够？</p>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => onAssess(card.session_id)}
            disabled={assessing}
          >
            {assessing ? '正在评估…' : '看这次评估'}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function MealCardView({ card }: { card: MealCard }) {
  return (
    <article className="card" aria-label="饮食记录">
      <div className="card-hd">
        <CheckIcon />
        <h3>{card.meal_type ? MEAL_LABEL[card.meal_type] : '饮食'}已记下</h3>
        <span className="tag tag--dashed">份量按估算</span>
      </div>
      <p className="card-meta">{card.items.length} 项 · 仅展示，未入库</p>
      <hr className="hr" />

      <dl className="ex-list is-meal">
        {card.items.map((item, i) => (
          <div key={`${i}-${item.raw_desc}`} className="ex-row">
            <dt>{item.raw_desc}</dt>
            <dd>
              {item.qty != null ? `${item.qty}${item.unit ?? ''}` : '份量未说'}
              {item.estimation_basis ? (
                <span className="meal-basis">（{item.estimation_basis}）</span>
              ) : null}
            </dd>
            <span className="val">—</span>
          </div>
        ))}
      </dl>

      <div className="stat-row" aria-label="营养估算">
        <div className="stat">
          <b>—</b>
          <span>kcal 合计</span>
        </div>
        <div className="stat">
          <b>—</b>
          <span>蛋白</span>
        </div>
        <div className="stat">
          <b>—</b>
          <span>碳水</span>
        </div>
      </div>

      <p className="foot-note">
        本版不估算热量与营养素；份量按你给的说法原样记录。下次直接说克数，记账会更准。
      </p>
    </article>
  );
}

function RefusalCardView({
  reply,
  onQuickAsk,
}: {
  reply: string;
  onQuickAsk?: (message: string) => void;
}) {
  return (
    <article className="card" aria-label="拒答">
      <div className="card-hd">
        <WarnIcon />
        <h3>这条我不能给建议</h3>
      </div>
      <div className="verdict">
        <p>{reply}</p>
        <span>红线是预先定好的规则，不交给模型即兴发挥</span>
      </div>
      <div className="note-inline">
        <InfoIcon />
        <p>这条对话不会记进训练记录，也不会参与容量计算。</p>
      </div>
      {onQuickAsk ? (
        <div className="ask">
          <p>训练记录本身不受影响</p>
          <button type="button" className="btn btn--sm" onClick={() => onQuickAsk('今天练了')}>
            记一下今天的训练
          </button>
        </div>
      ) : null}
    </article>
  );
}

function CorrectionCardView({ card }: { card: CorrectionCard }) {
  return (
    <article className="card" aria-label="已更正">
      <div className="card-hd">
        <RefreshIcon />
        <h3>已更正</h3>
        <span className="tag">容量已重算</span>
      </div>
      <p className="card-meta">
        {formatMonthDay(card.date)} · {card.split_label ?? '训练'} · 改了{' '}
        {card.corrected_sets} 组
      </p>
      <hr className="hr" />

      <dl className="ex-list">
        {card.exercises.map((exercise, i) => (
          <div key={`${i}-${exercise.raw_name}`} className="ex-row">
            <dt>{exerciseName(exercise)}</dt>
            <dd>
              {i === card.exercise_index
                ? correctedSetsText(exercise, card.old_weight_kg, card.new_weight_kg)
                : describeSets(exercise)}
            </dd>
            <span className="val">{formatKg(exercise.volume_kg)}</span>
          </div>
        ))}
      </dl>

      <div className="sum">
        <span>合计（正式组）</span>
        <b>
          {card.working_sets} 组 · {formatKg(card.volume_kg)}
        </b>
      </div>

      <p className="foot-note">
        容量按 Σ（重量 × 次数）重算，只算正式组 —— 数字由代码出，不由模型估。
      </p>
    </article>
  );
}

/** 「<s>70kg</s>75kg · 8 次 · 4 组」；组内次数不一致时退回普通描述 */
function correctedSetsText(exercise: WorkoutCardExercise, oldKg: number, newKg: number) {
  const working = exercise.sets.filter((s) => s.set_type === 'working');
  const reps = new Set(working.map((s) => s.reps));
  if (working.length === 0 || reps.size !== 1 || reps.has(null)) {
    return describeSets(exercise);
  }
  return (
    <>
      <span className="was">{oldKg}kg</span> {newKg}kg · {[...reps][0]} 次 · {working.length} 组
    </>
  );
}