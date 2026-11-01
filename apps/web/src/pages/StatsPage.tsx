import { useEffect, useMemo, useState } from 'react';
import { getStats } from '../api/client';
import type { StatsRange } from '../api/types';
import { BodyHeatMap } from '../components/BodyHeatMap';
import { DateField } from '../components/DateField';
import { LoadError } from '../components/LoadError';
import { WeightChart } from '../components/WeightChart';
import { startOfMonth, startOfWeekKey, toDateKey } from '../lib/calendar';
import { formatMd, formatMonthDay, formatNumber, formatSignedKg } from '../lib/format';

type RangeKey = 'day' | 'week' | 'month' | 'custom';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'day', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'custom', label: '自定义' },
];

const MAX_SPAN_DAYS = 366;

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

/** 统计页：选定范围内的容量 / 体重 / 肌群。 */
export function StatsPage() {
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const [rangeKey, setRangeKey] = useState<RangeKey>('week');
  const [customFrom, setCustomFrom] = useState(() => toDateKey(addDays(new Date(), -29)));
  const [customTo, setCustomTo] = useState(todayKey);
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
    if (range.from > range.to) return '开始日期不能晚于结束日期';
    if (spanDays(range.from, range.to) > MAX_SPAN_DAYS) return '范围最长 366 天';
    return null;
  }, [range]);

  useEffect(() => {
    if (rangeProblem) return;
    let alive = true;
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
    <div className="body page-body">
      <section className="sec" aria-label="统计范围">
        <div className="chips">
          {RANGES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`chip${rangeKey === key ? ' is-on' : ''}`}
              aria-pressed={rangeKey === key}
              onClick={() => setRangeKey(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {rangeKey === 'custom' ? (
          <div className="range-inputs">
            <DateField label="开始" value={customFrom} max={todayKey} onChange={setCustomFrom} />
            <DateField label="结束" value={customTo} max={todayKey} onChange={setCustomTo} />
          </div>
        ) : (
          <p className="page-hint">
            范围：{formatMonthDay(range.from)}
            {range.from === range.to ? '' : ` – ${formatMonthDay(range.to)}`}
          </p>
        )}

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
          <VolumeSection stats={stats} />
          <WeightSection stats={stats} />
          {stats.total_volume_kg > 0 ? (
            <section className="sec" aria-label="肌肉热力图">
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

function VolumeSection({ stats }: { stats: StatsRange }) {
  const max = Math.max(...stats.days.map((d) => d.total_volume_kg), 1);

  return (
    <section className="sec" aria-label="训练容量">
      <div className="sec-hd">
        <h2>训练容量</h2>
        <span className="hint">正式组 Σ 重量 × 次数</span>
      </div>
      <div className="chart-card">
        <div className="metric">
          <b>{formatNumber(stats.total_volume_kg)}</b>
          <span>kg · 本范围</span>
        </div>
        <p className="page-hint">
          正式组 {stats.working_sets} 组 · 训练 {stats.training_days} 天
        </p>

        {stats.days.length === 0 ? (
          <p className="page-hint">这个范围还没有训练记录。</p>
        ) : (
          <div
            className={`bars${stats.days.length > 7 ? ' bars--scroll' : ''}`}
            role="img"
            aria-label={`每日训练容量：${stats.days
              .map((d) => `${formatMd(d.date)} ${formatNumber(d.total_volume_kg)} 千克`)
              .join('、')}`}
          >
            {stats.days.map((day) => (
              <div key={day.date}>
                <i style={{ height: `${Math.round((day.total_volume_kg / max) * 60)}px` }} />
                <small>{formatMd(day.date)}</small>
              </div>
            ))}
          </div>
        )}
      </div>
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
            <b>{formatNumber(latest.weight_kg)}</b>
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