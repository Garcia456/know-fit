import { useEffect, useState, type FormEvent } from 'react';
import { getSession, patchSession, type PatchExerciseInput } from '../api/client';
import type { SessionDetail, SessionExercise } from '../api/types';
import { describeSets } from '../lib/exercise';
import { formatMonthDay } from '../lib/format';
import { RefreshIcon } from './Icons';

interface Props {
  sessionId: string;
  onDone: () => void;
}

interface MissingCell {
  key: string;
  exerciseIndex: number;
  setIndex: number;
  label: string;
  reps: string;
  weight: string;
  repsMissing: boolean;
  weightMissing: boolean;
}

function missingCells(detail: SessionDetail): MissingCell[] {
  const cells: MissingCell[] = [];
  detail.exercises.forEach((ex, exerciseIndex) => {
    ex.sets.forEach((set, setIndex) => {
      if (set.reps !== null && set.weight_kg !== null) return;
      cells.push({
        key: `${exerciseIndex}-${setIndex}`,
        exerciseIndex,
        setIndex,
        label: `${ex.name_zh ?? ex.raw_name} 第 ${setIndex + 1} 组`,
        reps: '',
        weight: '',
        repsMissing: set.reps === null,
        weightMissing: set.weight_kg === null,
      });
    });
  });
  return cells;
}

function exerciseName(ex: SessionExercise): string {
  return ex.name_zh ?? ex.raw_name;
}

/**
 * F7 补全：只补空值，走 PATCH，不新建 session。
 * 输入留空 = 这项还是不知道，不编数字。
 */
export function CompletionPanel({ sessionId, onDone }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [cells, setCells] = useState<MissingCell[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getSession(sessionId)
      .then((row) => {
        if (!alive) return;
        setDetail(row);
        setCells(missingCells(row));
        setNote(row.note ?? '');
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '记录加载失败');
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  function updateCell(key: string, field: 'reps' | 'weight', value: string) {
    setCells((prev) => prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)));
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!detail || saving) return;

    const byExercise = new Map<number, PatchExerciseInput>();
    for (const cell of cells) {
      const fillReps = cell.repsMissing && cell.reps.trim() !== '';
      const fillWeight = cell.weightMissing && cell.weight.trim() !== '';
      if (!fillReps && !fillWeight) continue;

      const reps = fillReps ? Number(cell.reps) : null;
      const weight = fillWeight ? Number(cell.weight) : null;
      if (fillReps && (reps === null || !Number.isInteger(reps) || reps <= 0)) {
        setError('次数要填正整数');
        return;
      }
      if (fillWeight && (weight === null || !Number.isFinite(weight) || weight <= 0)) {
        setError('重量要填正数');
        return;
      }

      const ex = detail.exercises[cell.exerciseIndex];
      if (!ex) continue;
      const bucket = byExercise.get(cell.exerciseIndex) ?? { raw_name: ex.raw_name, sets: [] };
      bucket.sets.push({
        weight_kg: weight,
        reps,
        set_type: ex.sets[cell.setIndex]?.set_type ?? 'working',
        is_inferred: false,
      });
      byExercise.set(cell.exerciseIndex, bucket);
    }

    const exercises = [...byExercise.values()];
    if (exercises.length === 0) {
      setError('至少补一个数，或点「先不补」');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await patchSession(sessionId, exercises, note.trim() || undefined);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '补全失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  if (!detail) {
    return (
      <section className="card" aria-label="补全上次记录">
        <div className="card-hd">
          <RefreshIcon />
          <h3>补充上次的记录</h3>
        </div>
        {error ? (
          <>
            <p className="error-text" role="alert">
              {error}
            </p>
            <div className="ask">
              <p>读不到这条记录</p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>
                关闭
              </button>
            </div>
          </>
        ) : (
          <p className="card-meta">正在读取上次记录…</p>
        )}
      </section>
    );
  }

  const unresolved = cells.filter((c) => {
    const filledReps = !c.repsMissing || c.reps.trim() !== '';
    const filledWeight = !c.weightMissing || c.weight.trim() !== '';
    return !(filledReps && filledWeight);
  }).length;

  return (
    <section className="card" aria-label="补全上次记录">
      <div className="card-hd">
        <RefreshIcon />
        <h3>补充上次的{detail.split_label ?? '训练'}</h3>
        <span className="tag">已预填</span>
      </div>
      <p className="card-meta">
        {formatMonthDay(detail.date)} · {unresolved > 0 ? `缺 ${unresolved} 项` : '没有缺数字的组'}
      </p>
      <hr className="hr" />

      <form onSubmit={handleSubmit} noValidate>
        {detail.exercises.map((ex, exerciseIndex) => {
          const exCells = cells.filter((c) => c.exerciseIndex === exerciseIndex);
          const empty = exCells.length > 0;
          return (
            <div key={`${exerciseIndex}-${ex.raw_name}`} className={`field-row${empty ? ' is-empty' : ''}`}>
              <span className="fname">{exerciseName(ex)}</span>
              {empty ? (
                <span className="fval">
                  {exCells.map((cell) => (
                    <span key={cell.key} className="cell-inputs">
                      <span className="cell-label">第 {cell.setIndex + 1} 组</span>
                      {cell.weightMissing ? (
                        <input
                          className="fval-input"
                          inputMode="decimal"
                          placeholder="重量 kg"
                          aria-label={`${cell.label} 重量`}
                          value={cell.weight}
                          onChange={(e) => updateCell(cell.key, 'weight', e.target.value)}
                        />
                      ) : null}
                      {cell.repsMissing ? (
                        <input
                          className="fval-input"
                          inputMode="numeric"
                          placeholder="次数"
                          aria-label={`${cell.label} 次数`}
                          value={cell.reps}
                          onChange={(e) => updateCell(cell.key, 'reps', e.target.value)}
                        />
                      ) : null}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="fval">{describeSets(ex)}</span>
              )}
              <span className="fhint">{empty ? '待填' : '已填'}</span>
            </div>
          );
        })}

        {detail.note === null ? (
          <div className="field-row">
            <span className="fname">备注</span>
            <span className="fval">
              <input
                className="fval-input fval-input--wide"
                placeholder="可选"
                aria-label="备注"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </span>
            <span className="fhint">可选</span>
          </div>
        ) : null}

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}

        <div className="ask">
          <p>只改这一项，其他不用重说一遍</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>
            先不补
          </button>
          <button type="submit" className="btn btn--sm" disabled={saving}>
            {saving ? '正在补…' : '保存补充'}
          </button>
        </div>
      </form>
    </section>
  );
}