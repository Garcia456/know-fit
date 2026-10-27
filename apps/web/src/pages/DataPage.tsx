import { useEffect, useMemo, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { Link, useSearchParams } from 'react-router';
import { getHistory, getSession } from '../api/client';
import type { HistoryItem, SessionDetail } from '../api/types';
import { ChartIcon } from '../components/Icons';
import { LoadError } from '../components/LoadError';
import { VolumeHookView } from '../components/VolumeHookView';
import { addMonths, monthGrid, parseDateKey, startOfMonth, toDateKey } from '../lib/calendar';
import { formatKg, formatMd, formatMonthDay } from '../lib/format';

const MISSING_LABELS: Record<string, string> = {
  exercises: '动作',
  reps: '次数',
  weight_kg: '重量',
};

const STATUS_LABELS = { complete: '已记完', incomplete: '待补全' } as const;

type Order = 'desc' | 'asc';

/** 历史页：日历 + 全部 / 某天训练记录（ADR-045）。 */
export function DataPage() {
  const [params] = useSearchParams();
  const paramDate = params.get('date');
  const [month, setMonth] = useState(() => {
    const d = paramDate ? parseDateKey(paramDate) : null;
    return startOfMonth(d ?? new Date());
  });
  const [selected, setSelected] = useState<string | null>(() =>
    paramDate && parseDateKey(paramDate) ? paramDate : null,
  );
  const [order, setOrder] = useState<Order>('desc');
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [details, setDetails] = useState<Record<string, SessionDetail>>({});
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [emblaRef, emblaApi] = useEmblaCarousel({ startIndex: 1, duration: 22 });

  useEffect(() => {
    let alive = true;
    getHistory(200)
      .then((res) => {
        if (alive) {
          setHistory(res.items);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '训练记录加载失败');
      });
    return () => {
      alive = false;
    };
  }, [reloadTick]);

  function retry() {
    setError(null);
    setReloadTick((n) => n + 1);
  }

  // 抽屉跳过来时按 ?date= 选中
  useEffect(() => {
    if (!paramDate) return;
    const d = parseDateKey(paramDate);
    if (!d) return;
    setSelected(paramDate);
    setMonth(startOfMonth(d));
  }, [paramDate]);

  // 滑到相邻月：换月份后回到中间那页
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const at = emblaApi.selectedScrollSnap();
      if (at === 1) return;
      setMonth((m) => addMonths(m, at - 1));
    };
    emblaApi.on('select', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi]);

  useEffect(() => {
    emblaApi?.scrollTo(1, true);
  }, [emblaApi, month]);

  const byDate = useMemo(() => {
    const map = new Map<string, HistoryItem[]>();
    for (const item of history ?? []) {
      const bucket = map.get(item.date) ?? [];
      bucket.push(item);
      map.set(item.date, bucket);
    }
    return map;
  }, [history]);

  const visible = useMemo(() => {
    const rows = selected ? (byDate.get(selected) ?? []) : (history ?? []);
    return [...rows].sort((a, b) =>
      order === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date),
    );
  }, [history, byDate, selected, order]);

  const detailKey = visible.map((s) => s.session_id).join(',');

  useEffect(() => {
    if (!detailKey) return;
    let alive = true;
    const missing = detailKey.split(',').filter((id) => !details[id]);
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => getSession(id)))
      .then((rows) => {
        if (!alive) return;
        setDetails((prev) => {
          const next = { ...prev };
          for (const row of rows) next[row.session_id] = row;
          return next;
        });
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '训练详情加载失败');
      });
    return () => {
      alive = false;
    };
  }, [detailKey, details, reloadTick]);

  const today = toDateKey(new Date());
  const monthTitle = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
  const slides = [addMonths(month, -1), month, addMonths(month, 1)];

  if (history !== null && history.length === 0 && !error) {
    return (
      <div className="body page-body">
        <div className="empty">
          <span className="glyph" aria-hidden="true">
            <ChartIcon />
          </span>
          <h2>还没有训练记录</h2>
          <p>
            记一次就会出趋势。
            <br />
            跟它说「今天练了背」就行，记不全也没关系。
          </p>
          <Link className="btn" to="/">
            去记录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="body page-body">
      {error ? (
        <LoadError message={`训练记录没读出来 · ${error}`} onRetry={retry} />
      ) : history === null ? (
        <p className="page-hint">正在加载…</p>
      ) : null}

      <section className="sec" aria-label="日历">
        <div className="sec-hd">
          <h2>{monthTitle}</h2>
        </div>

        <div
          className="calendar"
          role="group"
          aria-label="训练日历"
          tabIndex={0}
          data-swipe-ignore
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setMonth((m) => addMonths(m, -1));
            if (e.key === 'ArrowRight') setMonth((m) => addMonths(m, 1));
          }}
        >
          <div className="calendar__viewport" ref={emblaRef}>
            <div className="calendar__track">
              {slides.map((slideMonth) => (
                <div className="calendar__slide" key={`${slideMonth.getFullYear()}-${slideMonth.getMonth()}`}>
                  <div className="calendar__weekdays" aria-hidden="true">
                    {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
                      <span key={w}>{w}</span>
                    ))}
                  </div>

                  <div className="calendar__grid">
                    {monthGrid(slideMonth).map((key, cell) =>
                      key === null ? (
                        <span key={`blank-${cell}`} className="calendar__blank" />
                      ) : (
                        <button
                          key={key}
                          type="button"
                          className={[
                            'calendar__day',
                            key === selected ? 'is-selected' : '',
                            key === today ? 'is-today' : '',
                            byDate.has(key) ? 'is-marked' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-pressed={key === selected}
                          aria-label={`${key}${byDate.has(key) ? '，有训练' : ''}`}
                          onClick={() => {
                            setSelected((prev) => (prev === key ? null : key));
                            const d = parseDateKey(key);
                            if (
                              d &&
                              (d.getFullYear() !== month.getFullYear() ||
                                d.getMonth() !== month.getMonth())
                            ) {
                              setMonth(startOfMonth(d));
                            }
                          }}
                        >
                          {Number(key.slice(8))}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="sec" aria-label={selected ? '当天训练' : '全部训练记录'}>
        <div className="sec-hd">
          <h2>{selected ? formatMonthDay(selected) : '全部训练记录'}</h2>
          <button
            type="button"
            className="sort-toggle"
            aria-label={`切换排序，当前${order === 'desc' ? '倒序' : '正序'}`}
            onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
          >
            {order === 'desc' ? '倒序 ↓' : '正序 ↑'}
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="page-hint">
            {selected ? '这天没有训练' : '暂无记录'}
          </p>
        ) : selected ? (
          visible.map((s) => (
            <DayCard key={s.session_id} item={s} detail={details[s.session_id]} />
          ))
        ) : (
          <div className="list-card">
            {visible.map((item) => (
              <button
                key={item.session_id}
                type="button"
                className="row row-button"
                onClick={() => {
                  setSelected(item.date);
                  const d = parseDateKey(item.date);
                  if (d) setMonth(startOfMonth(d));
                }}
              >
                <div className="grow">
                  <p className="t1">
                    {item.split_label ?? '训练'} · {item.exercise_count} 个动作 /{' '}
                    {item.working_sets} 组
                  </p>
                  <p className="t2">
                    {item.exercise_names.length > 0
                      ? item.exercise_names.join(' · ')
                      : '动作名待确认'}
                  </p>
                </div>
                <div className="meta">
                  <div className="m1">{formatKg(item.volume_kg)}</div>
                  <div className="m2">
                    {item.status === 'incomplete'
                      ? `待补 ${item.missing_fields.length} 项`
                      : formatMd(item.date)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DayCard({ item, detail }: { item: HistoryItem; detail: SessionDetail | undefined }) {
  return (
    <article className="card">
      <div className="card-hd">
        <h3>{item.split_label ?? '训练'}</h3>
        <span className={item.status === 'complete' ? 'tag' : 'tag tag--dashed'}>
          {STATUS_LABELS[item.status]}
        </span>
      </div>

      {detail ? (
        <>
          <div className="day-hook">
            <VolumeHookView hook={detail.hook} />
          </div>

          <ul className="exercise-list">
            {detail.exercises.map((ex, exIndex) => (
              <li key={`${ex.raw_name}-${exIndex}`} className="exercise">
                <div className="exercise__name">{ex.name_zh ?? ex.raw_name}</div>
                <ul className="set-list">
                  {ex.sets.map((set, i) => (
                    <li key={i}>
                      {set.weight_kg === null ? '—' : formatKg(set.weight_kg)} ×{' '}
                      {set.reps === null ? '—' : set.reps}
                      {set.set_type === 'warmup' ? <span className="tag">热身</span> : null}
                      {set.is_inferred ? <span className="tag tag--dashed">推测</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {detail.missing_fields.length > 0 ? (
            <p className="page-hint">
              还缺：{detail.missing_fields.map((f) => MISSING_LABELS[f] ?? f).join('、')}
              —— 回到会话页可以补
            </p>
          ) : null}
          {detail.note ? <p className="card-meta">备注：{detail.note}</p> : null}
          {detail.volume.unrecognized_exercises > 0 ? (
            <p className="page-hint">
              有 {detail.volume.unrecognized_exercises} 个动作没认出来，未计入肌群分摊
            </p>
          ) : null}
        </>
      ) : (
        <p className="page-hint">正在加载详情…</p>
      )}
    </article>
  );
}