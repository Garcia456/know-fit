import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getStats } from '../api/client';
import type { StatsRange } from '../api/types';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { BodyHeatMap } from '../components/BodyHeatMap';
import { DateField } from '../components/DateField';
import { ChevronRightIcon } from '../components/Icons';
import { LoadError } from '../components/LoadError';
import { Segmented } from '../components/Segmented';
import { WeightChart } from '../components/WeightChart';
import { startOfMonth, startOfWeekKey, parseDateKey, toDateKey } from '../lib/calendar';
import { formatMonthDay, formatNumber, formatSignedKg } from '../lib/format';

type RangeKey = 'day' | 'week' | 'month' | 'custom';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'day', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'custom', label: '自定义' },
];

const MAX_SPAN_DAYS = 366;
/** 与 DateField 的默认最早年份保持一致，自动调整时不把日期推到滚轮范围外 */
const MIN_DATE_KEY = '2000-01-01';

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
  return !!value && parseDateKey(value) !== null;
}

/** 从某个日期键加减几天，仍返回日期键 */
function addDaysKey(key: string, days: number): string {
  return toDateKey(addDays(new Date(`${key}T00:00:00`), days));
}

/** 开始日越过 366 天窗口时，把结束日收回到窗口内，且不越过今天 */
function clampEnd(start: string, today: string): string {
  const capped = addDaysKey(start, MAX_SPAN_DAYS);
  return capped > today ? today : capped;
}

/** 结束日越过 366 天窗口时，把开始日收回到窗口内，且不越过滚轮最早一年 */
function clampStart(end: string): string {
  const candidate = addDaysKey(end, -MAX_SPAN_DAYS);
  return candidate < MIN_DATE_KEY ? MIN_DATE_KEY : candidate;
}

/** URL 里的区间能对上预设时，芯片仍显示「今天 / 本周 / 本月」，否则是自定义 */
function rangeKeyFor(from: string, to: string, today: Date, todayKey: string): RangeKey {
  if (from === todayKey && to === todayKey) return 'day';
  if (from === startOfWeekKey(today) && to === todayKey) return 'week';
  if (from === toDateKey(startOfMonth(today)) && to === todayKey) return 'month';
  return 'custom';
}

/** 统计页：选定范围内的容量 / 体重 / 肌群。 */
export function StatsPage() {
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const [searchParams, setSearchParams] = useSearchParams();

  // 只读一次：进页时可从 URL 恢复区间（二级页返回、刷新都不丢）
  const initialRange = useMemo(() => {
    const qFrom = searchParams.get('from');
    const qTo = searchParams.get('to');
    if (!isDateKey(qFrom) || !isDateKey(qTo)) return null;
    if (qFrom > qTo || qTo > todayKey || spanDays(qFrom, qTo) > MAX_SPAN_DAYS) return null;
    return { from: qFrom, to: qTo, key: rangeKeyFor(qFrom, qTo, today, todayKey) };
  }, [searchParams, today, todayKey]);

  const [rangeKey, setRangeKey] = useState<RangeKey>(() => initialRange?.key ?? 'week');
  const [customFrom, setCustomFrom] = useState(
    () => initialRange?.from ?? toDateKey(addDays(new Date(), -29)),
  );
  const [customTo, setCustomTo] = useState(() => initialRange?.to ?? todayKey);
  const [stats, setStats] = useState<StatsRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const range = useMemo(() => {
    if (rangeKey === 'day') return { from: todayKey, to: todayKey };
    if (rangeKey === 'week') return { from: startOfWeekKey(today), to: todayKey };
    if (rangeKey === 'month') return { from: toDateKey(startOfMonth(today)), to: todayKey };
    return { from: customFrom, to: customTo };
  }, [rangeKey, customFrom, customTo, today, todayKey]);

  const rangeProblem = useMemo(() => {
    if (!range.from || !range.to) return '请选择完整的起止日期';
    if (!parseDateKey(range.from) || !parseDateKey(range.to)) return '日期无效';
    if (range.to > todayKey) return '结束日期不能晚于今天';
    if (range.from > range.to) return '开始日期不能晚于结束日期';
    if (spanDays(range.from, range.to) > MAX_SPAN_DAYS) return '范围最长 366 天';
    return null;
  }, [range, todayKey]);

  // 区间写回 URL，供二级页与刷新复用；replace 不堆历史
  useEffect(() => {
    if (rangeProblem) return;
    if (searchParams.get('from') === range.from && searchParams.get('to') === range.to) return;
    const next = new URLSearchParams(searchParams);
    next.set('from', range.from);
    next.set('to', range.to);
    setSearchParams(next, { replace: true });
  }, [range.from, range.to, rangeProblem, searchParams, setSearchParams]);

  useEffect(() => {
    if (rangeProblem) {
      setStats(null);
      setLoading(false);
      return;
    }
    let alive = true;
    // 换区间时保留上一组数字，只做减淡；直接清空会让整页塌掉再长回来。
    setLoading(true);
    setError(null);
    getStats(range.from, range.to)
      .then((res) => {
        if (alive) setStats(res);
      })
      .catch((e: unknown) => {
        if (alive) {
          // 失败时不摆上一次范围的旧数字，免得读成当前范围的
          setStats(null);
          setError(e instanceof Error ? e.message : '统计数据加载失败');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range.from, range.to, rangeProblem, reloadTick]);

  return (
    <div
      className={`body page-body stats-page${loading && stats ? ' is-updating' : ''}`}
      aria-busy={loading || undefined}
    >
      <header className="page-head">
        <div>
          <p className="page-head__eyebrow">训练数据</p>
          <h1>统计</h1>
          <p className="page-head__sub">容量、体重和肌群分布，按你选的区间汇总。</p>
        </div>
      </header>

      <section className="sec stats-range" aria-label="统计范围">
        <div className="range-bar">
          <Segmented
            options={RANGES}
            value={rangeKey}
            onChange={(key) => setRangeKey(key as RangeKey)}
            ariaLabel="统计范围"
          />
          <p className="range-summary">
            <b>
              {formatMonthDay(range.from)}
              {range.from === range.to ? '' : ` – ${formatMonthDay(range.to)}`}
            </b>
            <span>
              {rangeProblem
                ? '范围需要调整'
                : loading
                  ? '正在更新…'
                  : stats
                    ? `${stats.training_days} 天有训练 · ${stats.hard_sets} 组有效`
                    : '正在读取区间…'}
            </span>
          </p>
        </div>

        {rangeKey === 'custom' ? (
          <div className="range-inputs">
            <DateField
              label="开始"
              value={customFrom}
              max={todayKey}
              onChange={(value) => {
                setCustomFrom(value);
                // 起止由系统跟着调：开始晚于结束就把结束一起推到同一天
                if (value > customTo) setCustomTo(value);
                else if (spanDays(value, customTo) > MAX_SPAN_DAYS) {
                  setCustomTo(clampEnd(value, todayKey));
                }
              }}
            />
            <DateField
              label="结束"
              value={customTo}
              max={todayKey}
              onChange={(value) => {
                setCustomTo(value);
                if (value < customFrom) setCustomFrom(value);
                else if (spanDays(customFrom, value) > MAX_SPAN_DAYS) {
                  setCustomFrom(clampStart(value));
                }
              }}
            />
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
          message={`统计没读出来 · ${error}`}
          onRetry={() => setReloadTick((n) => n + 1)}
        />
      ) : null}

      {stats === null ? (
        loading ? (
          <p className="page-hint">正在加载…</p>
        ) : error ? (
          <>
            <FailedSection label="训练容量" />
            <FailedSection label="体重趋势" />
          </>
        ) : null
      ) : (
        <>
          <HardSetsCard stats={stats} range={range} />
          <WeightSection stats={stats} />
          {stats.total_volume_kg > 0 ? (
            <section className="sec stats-heat" aria-label="肌肉热力图">
              <div className="sec-hd">
                <h2>肌肉热力图</h2>
                <span className="hint">整个范围聚合 · 5 档</span>
              </div>
              <div className="chart-card">
                <BodyHeatMap byMuscle={stats.by_muscle} />
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** 读取失败时占住版块，别让页面只剩一行报错 */
function FailedSection({ label }: { label: string }) {
  return (
    <section className="sec" aria-label={label}>
      <div className="sec-hd">
        <h2>{label}</h2>
        <span className="hint">未读到</span>
      </div>
      <div className="chart-card">
        <p className="page-hint">数据没读出来，重试后再看。</p>
      </div>
    </section>
  );
}

/** 主卡片只给一个数：总有效组数。肌群分布与明细进二级页。 */
function HardSetsCard({ stats, range }: { stats: StatsRange; range: { from: string; to: string } }) {
  const href = `/stats/hard-sets?from=${range.from}&to=${range.to}`;
  const empty = stats.days.length === 0;

  const body = (
    <>
      <div className="metric">
        <b>
          <AnimatedNumber value={stats.hard_sets} />
        </b>
        <span>有效组 · 本范围</span>
        {empty ? null : (
          <span className="hard-sets-card__more">
            查看肌群分布
            <ChevronRightIcon />
          </span>
        )}
      </div>
      <p className="page-hint">
        {empty
          ? '这个范围还没有训练记录。'
          : `训练 ${stats.training_days} 天 · 热身 ${stats.warmup_sets} 组不计`}
      </p>
    </>
  );

  return (
    <section className="sec" aria-label="训练容量">
      <div className="sec-hd">
        <h2>训练容量</h2>
        <span className="hint">有效组 · 热身不计</span>
      </div>
      {empty ? (
        <div className="chart-card">{body}</div>
      ) : (
        <Link
          className="chart-card hard-sets-card"
          to={href}
          aria-label={`总有效组数 ${stats.hard_sets} 组，查看肌群分布`}
        >
          {body}
        </Link>
      )}
    </section>
  );
}

function WeightSection({ stats }: { stats: StatsRange }) {
  const points = stats.weight_points;
  const latest = stats.weight_latest;
  const delta = stats.weight_delta_kg;
  const deltaClass = delta == null || delta === 0 ? '' : delta > 0 ? 'up' : 'down';
  const deltaText =
    delta == null
      ? null
      : delta === 0
        ? '持平'
        : `${delta > 0 ? '▲' : '▼'} ${formatSignedKg(Math.abs(delta)).replace('+', '')}`;

  return (
    <section className="sec" aria-label="体重趋势">
      <div className="sec-hd">
        <h2>体重趋势</h2>
        <span className="hint">
          {latest ? `${formatMonthDay(latest.date)}更新` : '本范围暂无记录'}
        </span>
      </div>
      <div className="chart-card">
        {latest ? (
          <div className="metric">
            <b>
              <AnimatedNumber value={latest.weight_kg} format={formatNumber} />
            </b>
            <span>kg</span>
            {deltaText ? (
              <span className={`delta ${deltaClass}`} style={{ marginLeft: 'auto' }}>
                {deltaText}
              </span>
            ) : null}
          </div>
        ) : null}

        {points.length < 2 ? (
          <p className="page-hint">
            {points.length === 0
              ? '这个范围还没有体重记录 —— 在「我的」填一次'
              : '记两次体重后才出趋势'}
          </p>
        ) : (
          <WeightChart points={points} />
        )}
      </div>
    </section>
  );
}
