import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getStats } from '../api/client';
import type { ExerciseHardSet, MuscleGroupHardSet, StatsRange } from '../api/types';
import { DateField } from '../components/DateField';
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ChevronDownIcon,
} from '../components/Icons';
import { LoadError } from '../components/LoadError';
import { startOfWeekKey, toDateKey } from '../lib/calendar';
import { formatDeltaPct, formatMonthDay, formatNumber } from '../lib/format';

const MAX_SPAN_DAYS = 366;

type RangeKey = 'week' | '4w' | '12w' | 'custom';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'week', label: '本周' },
  { key: '4w', label: '近 4 周' },
  { key: '12w', label: '近 12 周' },
  { key: 'custom', label: '自定义' },
];

function addDays(d: Date, days: number): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() + days);
  return c;
}

function spanDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * 60 * 1000),
  );
}

function isDateKey(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function presetRange(key: Exclude<RangeKey, 'custom'>, today: Date, todayKey: string) {
  if (key === 'week') return { from: startOfWeekKey(today), to: todayKey };
  const days = key === '4w' ? 28 : 84;
  return { from: toDateKey(addDays(today, -(days - 1))), to: todayKey };
}

function rangeKeyFor(from: string, to: string, today: Date, todayKey: string): RangeKey {
  if (to === todayKey) {
    if (from === startOfWeekKey(today)) return 'week';
    if (from === toDateKey(addDays(today, -27))) return '4w';
    if (from === toDateKey(addDays(today, -83))) return '12w';
  }
  return 'custom';
}

function sharePct(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

/** 二级页：总有效组数的肌群分布与明细。区间可直接在页内调整，并写回 URL。 */
export function HardSetsPage() {
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const [params, setParams] = useSearchParams();

  // 只读一次：进页时可从 URL 恢复区间（统计页跳转、刷新都不丢）
  const initialRange = useMemo(() => {
    const from = params.get('from');
    const to = params.get('to');
    if (!isDateKey(from) || !isDateKey(to)) {
      return { from: startOfWeekKey(today), to: todayKey, key: 'week' as RangeKey };
    }
    if (from > to || spanDays(from, to) > MAX_SPAN_DAYS) {
      return { from: startOfWeekKey(today), to: todayKey, key: 'week' as RangeKey };
    }
    return { from, to, key: rangeKeyFor(from, to, today, todayKey) };
  }, [params, today, todayKey]);

  const [rangeKey, setRangeKey] = useState<RangeKey>(initialRange.key);
  const [customFrom, setCustomFrom] = useState(initialRange.from);
  const [customTo, setCustomTo] = useState(initialRange.to);

  const range = useMemo(() => {
    if (rangeKey === 'custom') return { from: customFrom, to: customTo };
    return presetRange(rangeKey, today, todayKey);
  }, [rangeKey, customFrom, customTo, today, todayKey]);

  const rangeProblem = useMemo(() => {
    if (!range.from || !range.to) return '请选择完整的起止日期';
    if (range.from > range.to) return '开始日期不能晚于结束日期';
    if (spanDays(range.from, range.to) > MAX_SPAN_DAYS) return '范围最长 366 天';
    return null;
  }, [range]);

  // 区间写回 URL，供返回统计页与刷新复用；replace 不堆历史
  useEffect(() => {
    if (rangeProblem) return;
    if (params.get('from') === range.from && params.get('to') === range.to) return;
    const next = new URLSearchParams(params);
    next.set('from', range.from);
    next.set('to', range.to);
    setParams(next, { replace: true });
  }, [range.from, range.to, rangeProblem, params, setParams]);

  const [stats, setStats] = useState<StatsRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (rangeProblem) {
      setStats(null);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    // 换区间先清掉旧数字，避免短暂把上一段范围的数读成当前范围
    setStats(null);
    setLoading(true);
    setError(null);
    getStats(range.from, range.to)
      .then((res) => {
        if (alive) setStats(res);
      })
      .catch((e: unknown) => {
        if (alive) {
          setStats(null);
          setError(e instanceof Error ? e.message : '肌群分布加载失败');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range.from, range.to, rangeProblem, reloadTick]);

  function chooseRange(key: RangeKey) {
    if (key === 'custom') {
      setCustomFrom(range.from);
      setCustomTo(range.to);
    }
    setRangeKey(key);
  }

  const backHref = `/stats?from=${range.from}&to=${range.to}`;

  return (
    <div className="hard-sets-shell">
      <header className="hard-sets-hd">
        <Link className="icon-btn" to={backHref} aria-label="返回统计">
          <ArrowLeftIcon />
        </Link>
        <h1>有效组数</h1>
        <span className="hard-sets-hd__spacer" aria-hidden="true" />
      </header>

      <div className="body page-body hard-sets-page">
        <section className="sec stats-range" aria-label="统计范围">
          <div className="range-bar">
            <div className="segmented" role="group" aria-label="统计范围">
              {RANGES.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`chip${rangeKey === key ? ' is-on' : ''}`}
                  aria-pressed={rangeKey === key}
                  onClick={() => chooseRange(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="range-summary">
              <b>
                {formatMonthDay(range.from)}
                {range.from === range.to ? '' : ` – ${formatMonthDay(range.to)}`}
              </b>
              <span>
                {rangeProblem
                  ? '范围需要调整'
                  : error
                    ? '这个范围没读出来'
                    : stats
                      ? `${stats.training_days} 天有训练 · ${stats.hard_sets} 组有效`
                      : '正在读取区间…'}
              </span>
            </p>
          </div>

          {rangeKey === 'custom' ? (
            <div className="range-inputs">
              <DateField label="开始" value={customFrom} max={todayKey} onChange={setCustomFrom} />
              <DateField label="结束" value={customTo} max={todayKey} onChange={setCustomTo} />
            </div>
          ) : null}

          {rangeProblem ? (
            <p className="error-text" role="alert">
              {rangeProblem}
            </p>
          ) : null}
        </section>

        {error ? (
          <LoadError
            message={`肌群分布没读出来 · ${error}`}
            onRetry={() => setReloadTick((n) => n + 1)}
          />
        ) : null}

        {rangeProblem ? <p className="page-hint">调整起止日期后，这里会重新汇总。</p> : null}

        {stats === null ? (
          loading ? (
            <p className="page-hint">正在加载…</p>
          ) : error ? (
            <section className="sec" aria-label="有效组数">
              <div className="chart-card">
                <p className="page-hint">数据没读出来，重试后再看。</p>
              </div>
            </section>
          ) : null
        ) : (
          <>
            <Overview stats={stats} />
            <Distribution stats={stats} />
            <Unclassified stats={stats} />
            <Tonnage stats={stats} />
          </>
        )}
      </div>
    </div>
  );
}

function Overview({ stats }: { stats: StatsRange }) {
  const { previous } = stats;
  const attrs: string[] = [`训练 ${stats.training_days} 天`];
  if (stats.training_days > 0) {
    attrs.push(`平均每次 ${formatNumber(stats.hard_sets / stats.training_days)} 组`);
  }
  if (stats.inferred_hard_sets > 0) attrs.push(`其中推测 ${stats.inferred_hard_sets} 组`);

  const deltaText =
    previous.hard_sets === 0
      ? '上期无记录'
      : previous.delta === 0
        ? '与上期持平'
        : `较上期 ${previous.delta > 0 ? '+' : ''}${previous.delta} 组${
            previous.delta_pct == null ? '' : `（${formatDeltaPct(previous.delta_pct)}）`
          }`;

  return (
    <section className="sec" aria-label="概览">
      <div className="sec-hd">
        <h2>概览</h2>
        <span className="hint">原始组数 · 热身不计</span>
      </div>
      <div className="chart-card">
        <div className="metric">
          <b>{stats.hard_sets}</b>
          <span>有效组</span>
          <span className={`hard-sets-delta${previous.hard_sets === 0 ? ' is-empty' : ''}`}>
            {previous.hard_sets === 0 ? null : previous.delta > 0 ? (
              <ArrowUpIcon />
            ) : previous.delta < 0 ? (
              <ArrowDownIcon />
            ) : null}
            {deltaText}
          </span>
        </div>
        <p className="page-hint">{attrs.join(' · ')}</p>
        <p className="page-hint">概览按原始组数计；下方肌群分布按加权组数计。</p>
      </div>
    </section>
  );
}

function Distribution({ stats }: { stats: StatsRange }) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

  if (stats.days.length === 0) {
    return (
      <section className="sec" aria-label="肌群分布">
        <div className="sec-hd">
          <h2>肌群分布</h2>
        </div>
        <div className="chart-card">
          <p className="page-hint">这个范围还没有训练记录。</p>
        </div>
      </section>
    );
  }

  const rows = stats.muscle_groups;
  const scale = Math.max(...rows.map((group) => group.hard_sets), 1);
  // 固定按组数倒序；组数为 0 的保持原有部位顺序
  const ordered = [...rows].sort((a, b) => b.hard_sets - a.hard_sets);
  const allOpen = rows.length > 0 && rows.every((group) => openIds.has(group.id));

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setOpenIds(allOpen ? new Set() : new Set(rows.map((group) => group.id)));
  }

  return (
    <section className="sec" aria-label="肌群分布">
      <div className="sec-hd">
        <h2>肌群分布</h2>
        <span className="hint">加权组数</span>
      </div>
      <div className="list-card">
        <div className="group-toolbar">
          <div className="group-actions">
            <button
              type="button"
              className="sort-toggle"
              aria-label={allOpen ? '全部收起肌群明细' : '全部展开肌群明细'}
              aria-pressed={allOpen}
              onClick={toggleAll}
            >
              {allOpen ? '全部收起' : '全部展开'}
            </button>
          </div>
        </div>
        {ordered.map((group) => (
          <GroupRow
            key={group.id}
            group={group}
            scale={scale}
            open={openIds.has(group.id)}
            onToggle={() => toggle(group.id)}
          />
        ))}
      </div>
    </section>
  );
}

function GroupRow({
  group,
  scale,
  open,
  onToggle,
}: {
  group: MuscleGroupHardSet;
  scale: number;
  open: boolean;
  onToggle: () => void;
}) {
  const width =
    group.hard_sets > 0 ? `${Math.max(2, Math.round((group.hard_sets / scale) * 100))}%` : '0%';
  const trained = group.muscles.filter((m) => m.hard_sets > 0);
  const detailId = `group-detail-${group.id}`;

  return (
    <div className="group-item">
      <button
        type="button"
        className="group-row"
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={onToggle}
      >
        <span className="group-row__name">{group.name_zh}</span>
        <span className="group-row__bar" aria-hidden="true">
          <i style={{ width }} />
        </span>
        <span className="group-row__num">{formatNumber(group.hard_sets)} 组</span>
        <span className={`group-row__chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          <ChevronDownIcon size={14} />
        </span>
      </button>
      {open ? (
        <div className="group-detail" id={detailId}>
          {trained.length === 0 ? (
            <p className="page-hint">这个范围没有练到。</p>
          ) : (
            trained.map((muscle) => {
              const pct = sharePct(muscle.hard_sets, group.hard_sets);
              return (
                <div key={muscle.id} className="muscle-line">
                  <p className="muscle-line__hd">
                    <b>{muscle.name_zh}</b>
                    <span>
                      {formatNumber(muscle.hard_sets)} 组 · 占 {pct}%
                    </span>
                  </p>
                  <span className="muscle-line__bar" aria-hidden="true">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <ul>
                    {muscle.sources.map((source) => (
                      <SourceLine
                        key={`${source.exercise_id ?? source.name}`}
                        source={source}
                        total={muscle.hard_sets}
                      />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function SourceLine({ source, total }: { source: ExerciseHardSet; total: number }) {
  const pct = sharePct(source.hard_sets, total);
  return (
    <li className="source-line">
      <p className="source-line__hd">
        <span>{source.name}</span>
        <span>
          {formatNumber(source.hard_sets)} 组 · 加权 {formatNumber(source.weighted_sets)}
        </span>
      </p>
      <span className="source-line__bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
    </li>
  );
}

function Unclassified({ stats }: { stats: StatsRange }) {
  const { unclassified } = stats;
  if (unclassified.hard_sets === 0) return null;

  const regions = Object.entries(unclassified.by_region);
  const share = sharePct(unclassified.hard_sets, stats.hard_sets);

  return (
    <section className="sec" aria-label="未归类">
      <div className="sec-hd">
        <h2>未归类</h2>
        <span className="hint">
          没摊进肌群 · {unclassified.hard_sets} 组
          {share > 0 ? ` · 占 ${share}%` : ''}
        </span>
      </div>
      <div className="chart-card">
        {regions.length > 0 ? (
          <ul className="unclassified-list">
            {regions.map(([region, sets]) => (
              <li key={region}>
                <span>{unclassified.region_labels[region] ?? region}</span>
                <span>
                  {sets} 组 · {sharePct(sets, unclassified.hard_sets)}%
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {unclassified.unrecognized_hard_sets > 0 ? (
          <p className="page-hint">
            另有 {unclassified.unrecognized_hard_sets} 组连部位都定不到。
          </p>
        ) : null}
        <ul className="unclassified-list">
          {unclassified.exercises.map((ex) => (
            <li key={`${ex.region_fallback ?? 'none'}::${ex.name}`}>
              <span>{ex.name}</span>
              <span>
                {ex.hard_sets} 组 · {sharePct(ex.hard_sets, unclassified.hard_sets)}%
              </span>
            </li>
          ))}
        </ul>
        <p className="page-hint">这些动作没归并到动作库，所以只算总组数、不进肌群分布。</p>
      </div>
    </section>
  );
}

function Tonnage({ stats }: { stats: StatsRange }) {
  return (
    <section className="sec" aria-label="吨位（辅助）">
      <div className="sec-hd">
        <h2>吨位（辅助）</h2>
        <span className="hint">只用于同一动作的纵向比较</span>
      </div>
      <div className="chart-card">
        <div className="metric">
          <b>{formatNumber(stats.total_volume_kg)}</b>
          <span>kg · 本范围</span>
        </div>
        <p className="page-hint">正式组 Σ 重量 × 次数；与上面的有效组数不是同一个口径。</p>
      </div>
    </section>
  );
}
