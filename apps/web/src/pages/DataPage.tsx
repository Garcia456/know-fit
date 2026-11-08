import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { Link, useSearchParams } from 'react-router';
import {
  deleteSession,
  getHistory,
  getSession,
  putSession,
  type UpdateExerciseInput,
} from '../api/client';
import type { HistoryItem, SessionDetail, SetTag, WorkoutCardSet } from '../api/types';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DragHandleIcon,
  EllipsisIcon,
  InfoIcon,
  SquarePenIcon,
  TrashIcon,
} from '../components/Icons';
import { LoadError } from '../components/LoadError';
import { Tip } from '../components/Tip';
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

/** 历史页：日历 + 全部 / 某天训练记录。 */
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

  // 编辑保存后以服务端回读为准：详情换新，列表里的组数 / 容量跟着换
  function handleSaved(detail: SessionDetail) {
    setDetails((prev) => ({ ...prev, [detail.session_id]: detail }));
    setHistory((prev) =>
      prev
        ? prev.map((item) =>
            item.session_id === detail.session_id
              ? {
                  ...item,
                  split_label: detail.split_label,
                  status: detail.status,
                  missing_fields: detail.missing_fields,
                  working_sets: detail.volume.working_sets,
                  volume_kg: detail.volume.total_volume_kg,
                }
              : item,
          )
        : prev,
    );
  }

  function handleDeleted(id: string) {
    setHistory((prev) => (prev ? prev.filter((item) => item.session_id !== id) : prev));
    setDetails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
            跟它说「今天练了背，高位下拉 60kg×10 四组」就行，记不全也没关系。
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
            {order === 'desc' ? (
              <>
                倒序
                <ArrowDownIcon />
              </>
            ) : (
              <>
                正序
                <ArrowUpIcon />
              </>
            )}
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="page-hint">
            {selected ? '这天没有训练' : '暂无记录'}
          </p>
        ) : selected ? (
          visible.map((s) => (
            <DayCard
              key={s.session_id}
              item={s}
              detail={details[s.session_id]}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
            />
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

interface Props {
  item: HistoryItem;
  detail: SessionDetail | undefined;
  onSaved: (detail: SessionDetail) => void;
  onDeleted: (id: string) => void;
}

interface DraftDrop {
  weight: string;
  reps: string;
}

interface DraftSet {
  /** 稳定 id：拖动换位时 React 不重挂行，动画才跟得上 */
  key: string;
  weight: string;
  reps: string;
  setType: 'warmup' | 'working';
  isInferred: boolean;
  tags: SetTag[];
  drops: DraftDrop[];
}

interface DraftExercise {
  raw_name: string;
  /** 改名前，用来判断是否动过名字 */
  original_name: string;
  /** 服务端当初的归一结论：改过名就作废，等保存后重新判定 */
  recognized: boolean;
  sets: DraftSet[];
}

let setKeySeq = 0;
function nextSetKey(): string {
  setKeySeq += 1;
  return `set-${setKeySeq}`;
}

function toDraft(detail: SessionDetail): DraftExercise[] {
  return detail.exercises.map((ex) => ({
    raw_name: ex.raw_name,
    original_name: ex.raw_name,
    recognized: ex.exercise_id !== null || ex.region_fallback !== null,
    sets: ex.sets.map((set) => ({
      key: nextSetKey(),
      weight: set.weight_kg === null ? '' : String(set.weight_kg),
      reps: set.reps === null ? '' : String(set.reps),
      setType: set.set_type,
      isInferred: set.is_inferred,
      tags: set.tags ?? [],
      // 旧数据把主段也放进 drops：编辑时去掉重复的那段
      drops: (set.drops ?? [])
        .filter(
          (d, i) =>
            !(i === 0 && d.weight_kg === set.weight_kg && d.reps === set.reps),
        )
        .map((d) => ({
          weight: d.weight_kg === null ? '' : String(d.weight_kg),
          reps: d.reps === null ? '' : String(d.reps),
        })),
    })),
  }));
}

/** 一组拆成主段 + 后续段；后续段没写重量就沿用主段 */
function setSegments(set: WorkoutCardSet): { weight: number | null; reps: number | null }[] {
  const main = { weight: set.weight_kg, reps: set.reps };
  const drops = set.drops ?? [];
  const carriesMain =
    drops.length > 0 && drops[0]?.weight_kg === main.weight && drops[0]?.reps === main.reps;
  const extra = carriesMain ? drops : [{ weight_kg: main.weight, reps: main.reps }, ...drops];
  return extra.map((d) => ({ weight: d.weight_kg ?? main.weight, reps: d.reps }));
}

/** 聚焦即全选：输入第一个数字时旧值被替换 */
function selectAll(e: FocusEvent<HTMLInputElement>) {
  e.currentTarget.select();
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

/** 动作名后的浅灰信息点：这组动作里含系统推测的数字；点一下浮出说明，3s 后淡出 */
function InferredDot() {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  function show() {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, 3000);
  }

  return (
    <span className="inferred-hint">
      <button
        type="button"
        className="inferred-dot"
        aria-label="含系统推测的数字"
        aria-expanded={open}
        onClick={show}
      >
        <InfoIcon size={12} />
      </button>
      {open ? (
        <span className="inferred-tip" role="status">
          有系统推测的数字，点编辑可以改
        </span>
      ) : null}
    </span>
  );
}

function decimalText(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '')}`;
}

/** 编辑态：没改名的照原结论计；改过名的等保存后由服务端重新归一 */
function unrecognizedHint(draft: DraftExercise[]) {
  const renamed = (ex: DraftExercise) => ex.raw_name.trim() !== ex.original_name.trim();
  const unknown = draft.filter((ex) => !ex.recognized && !renamed(ex)).length;
  const pending = draft.filter((ex) => !ex.recognized && renamed(ex)).length;
  if (unknown === 0 && pending === 0) return null;
  return (
    <p className="page-hint">
      {unknown > 0 ? `有 ${unknown} 个动作没认出来，未计入肌群分摊` : null}
      {unknown > 0 && pending > 0 ? '；' : null}
      {pending > 0 ? `改过名的 ${pending} 个动作保存后重新核对` : null}
    </p>
  );
}

function DayCard({ item, detail, onSaved, onDeleted }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftExercise[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 拖动中的组：动作下标 + 组的 key */
  const [dragging, setDragging] = useState<{ ex: number; key: string } | null>(null);
  /** 组行末尾的省略号菜单 */
  const [menu, setMenu] = useState<{ ex: number; key: string } | null>(null);
  const dragRef = useRef<{
    ex: number;
    key: string;
    startY: number;
    startTop: number;
    height: number;
    offset: number;
  } | null>(null);
  /** 换位前各行的位置，供 useLayoutEffect 做 FLIP */
  const flipRef = useRef<Map<string, number> | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const menuRef = useRef<HTMLDivElement>(null);

  const status = detail?.status ?? item.status;

  // 换位后：其余行从旧位置平滑滑到新位置；被拖的行贴住指针
  useLayoutEffect(() => {
    const tops = flipRef.current;
    flipRef.current = null;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    for (const [key, el] of rowRefs.current) {
      if (!el.isConnected) continue;
      if (dragging && key === dragging.key) {
        const drag = dragRef.current;
        if (drag) el.style.transform = `translateY(${drag.startTop + drag.offset - el.offsetTop}px)`;
        continue;
      }
      const before = tops?.get(key);
      if (before === undefined || reduce) continue;
      const dy = before - el.offsetTop;
      if (Math.abs(dy) < 1 || typeof el.animate !== 'function') continue;
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)' },
      );
    }
  }, [draft, dragging]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // 触发按钮自己负责开合，点它不在这里关
      if (target?.closest('.set-menu-trigger')) return;
      if (menuRef.current?.contains(target)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  function startEdit() {
    if (!detail) return;
    setDraft(toDraft(detail));
    setEditing(true);
    setConfirming(false);
    setMenu(null);
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft([]);
    setMenu(null);
    setError(null);
  }

  function patchSet(exIndex: number, setIndex: number, patch: Partial<DraftSet>) {
    setDraft((prev) =>
      prev.map((ex, i) =>
        i === exIndex
          ? {
              ...ex,
              sets: ex.sets.map((set, j) =>
                j === setIndex ? { ...set, ...patch, isInferred: false } : set,
              ),
            }
          : ex,
      ),
    );
  }

  function patchDrop(
    exIndex: number,
    setIndex: number,
    dropIndex: number,
    patch: Partial<DraftDrop>,
  ) {
    setDraft((prev) =>
      prev.map((ex, i) =>
        i === exIndex
          ? {
              ...ex,
              sets: ex.sets.map((set, j) =>
                j === setIndex
                  ? {
                      ...set,
                      isInferred: false,
                      drops: set.drops.map((drop, k) =>
                        k === dropIndex ? { ...drop, ...patch } : drop,
                      ),
                    }
                  : set,
              ),
            }
          : ex,
      ),
    );
  }

  /** 改动作名 = 用户认领这个动作：推测标记全部撤销；识别结论交回服务端 */
  function renameExercise(exIndex: number, raw_name: string) {
    setDraft((prev) =>
      prev.map((ex, i) =>
        i === exIndex
          ? {
              ...ex,
              raw_name,
              sets: ex.sets.map((set) => ({ ...set, isInferred: false })),
            }
          : ex,
      ),
    );
  }

  function removeExercise(exIndex: number) {
    setDraft((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== exIndex)));
  }

  /** 在某组下方插入一组相同的数据 */
  function duplicateSet(exIndex: number, setIndex: number) {
    setDraft((prev) =>
      prev.map((ex, i) => {
        if (i !== exIndex) return ex;
        const source = ex.sets[setIndex];
        if (!source) return ex;
        return {
          ...ex,
          sets: [
            ...ex.sets.slice(0, setIndex + 1),
            {
              ...source,
              key: nextSetKey(),
              isInferred: false,
              tags: [...source.tags],
              drops: source.drops.map((drop) => ({ ...drop })),
            },
            ...ex.sets.slice(setIndex + 1),
          ],
        };
      }),
    );
  }

  function removeSet(exIndex: number, setIndex: number) {
    setDraft((prev) =>
      prev.map((ex, i) => {
        if (i !== exIndex || ex.sets.length <= 1) return ex;
        return { ...ex, sets: ex.sets.filter((_, j) => j !== setIndex) };
      }),
    );
  }

  function moveSet(exIndex: number, from: number, to: number) {
    if (from === to) return;
    setDraft((prev) =>
      prev.map((ex, i) => {
        if (i !== exIndex) return ex;
        const sets = [...ex.sets];
        const [moved] = sets.splice(from, 1);
        if (!moved) return ex;
        sets.splice(to, 0, moved);
        return { ...ex, sets };
      }),
    );
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, exIndex: number, key: string) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const el = rowRefs.current.get(key);
    dragRef.current = {
      ex: exIndex,
      key,
      startY: event.clientY,
      startTop: el?.offsetTop ?? 0,
      height: el?.offsetHeight ?? 0,
      offset: 0,
    };
    setMenu(null);
    setDragging({ ex: exIndex, key });
  }

  /**
   * 被拖的行跟着指针走；它的中心越过谁的中间线，就跟谁换位。
   * 量 offsetTop 而不是 getBoundingClientRect —— 别把正在播的让位动画算进去。
   */
  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.offset = event.clientY - drag.startY;

    const self = rowRefs.current.get(drag.key);
    const list = self?.parentElement;
    if (!self || !list) return;
    const rows = Array.from(list.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('edit-set'),
    );
    const from = rows.indexOf(self);

    const center = drag.startTop + drag.offset + drag.height / 2;
    const above = rows.filter(
      (row) => row !== self && row.offsetTop + row.offsetHeight / 2 < center,
    ).length;

    if (above === from) {
      self.style.transform = `translateY(${drag.startTop + drag.offset - self.offsetTop}px)`;
      return;
    }

    const tops = new Map<string, number>();
    for (const row of rows) {
      if (row.dataset.setKey) tops.set(row.dataset.setKey, row.offsetTop);
    }
    flipRef.current = tops;
    moveSet(drag.ex, from, above);
    setDragging({ ex: drag.ex, key: drag.key });
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) {
      const el = rowRefs.current.get(drag.key);
      const from = el?.style.transform ?? '';
      if (el) el.style.transform = '';
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      if (el && from && !reduce && typeof el.animate === 'function') {
        el.animate([{ transform: from }, { transform: 'translateY(0)' }], {
          duration: 180,
          easing: 'cubic-bezier(.2, .8, .2, 1)',
        });
      }
    }
    setDragging(null);
  }


  async function handleSave() {
    if (!detail) return;
    setError(null);
    const exercises: UpdateExerciseInput[] = [];
    for (const ex of draft) {
      const raw_name = ex.raw_name.trim();
      if (!raw_name) {
        setError('动作名不能为空');
        return;
      }
      const sets: UpdateExerciseInput['sets'] = [];
      for (const set of ex.sets) {
        const weightText = set.weight.trim();
        const repsText = set.reps.trim();
        const weight_kg = weightText === '' ? null : Number(weightText);
        const reps = repsText === '' ? null : Number(repsText);
        if (weight_kg !== null && (!Number.isFinite(weight_kg) || weight_kg < 0)) {
          setError('重量要填数字');
          return;
        }
        if (reps !== null && (!Number.isInteger(reps) || reps <= 0)) {
          setError('次数要填正整数');
          return;
        }

        const drops: NonNullable<UpdateExerciseInput['sets'][number]['drops']> = [];
        for (const drop of set.drops) {
          const dropWeightText = drop.weight.trim();
          const dropRepsText = drop.reps.trim();
          const dropWeight = dropWeightText === '' ? null : Number(dropWeightText);
          const dropReps = dropRepsText === '' ? null : Number(dropRepsText);
          if (dropWeight !== null && (!Number.isFinite(dropWeight) || dropWeight < 0)) {
            setError('后续段重量要填数字');
            return;
          }
          if (dropReps !== null && (!Number.isInteger(dropReps) || dropReps <= 0)) {
            setError('后续段次数要填正整数');
            return;
          }
          drops.push({ weight_kg: dropWeight, reps: dropReps });
        }

        sets.push({
          weight_kg,
          reps,
          ...(set.tags.length > 0 ? { tags: set.tags } : {}),
          ...(drops.length > 0 ? { drops } : {}),
        });
      }
      exercises.push({ raw_name, sets });
    }

    setSaving(true);
    try {
      const next = await putSession(item.session_id, exercises, detail.note);
      onSaved(next);
      setEditing(false);
      setDraft([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteSession(item.session_id);
      onDeleted(item.session_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
      setDeleting(false);
    }
  }

  return (
    <article className="card">
      <div className="card-hd">
        <h3>{item.split_label ?? '训练'}</h3>
        <span className={status === 'complete' ? 'tag' : 'tag tag--dashed'}>
          {STATUS_LABELS[status]}
        </span>
        {detail ? (
          <div className="card-actions">
            {editing ? (
              <>
                <Tip text="撤销修改" align="end">
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label="撤销修改"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    <CloseIcon />
                  </button>
                </Tip>
                <Tip text="保存修改" align="end">
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label="保存修改"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    <CheckIcon />
                  </button>
                </Tip>
              </>
            ) : (
              <>
                <Tip text="编辑" align="end">
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label="编辑这次训练"
                    onClick={startEdit}
                  >
                    <SquarePenIcon />
                  </button>
                </Tip>
                <Tip text="删除" align="end">
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label="删除这次训练"
                    onClick={() => {
                      setConfirming(true);
                      setError(null);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </Tip>
              </>
            )}
          </div>
        ) : null}
      </div>

      {confirming ? (
        <div className="danger-box" role="alertdialog" aria-label="确认删除这次训练">
          <p>删掉这次训练？训练记录和评估会一起删除，不能恢复。</p>
          <div className="danger-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? '删除中…' : '确认删除'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      {detail ? (
        <>
          <div className="day-hook">
            <VolumeHookView hook={detail.hook} />
          </div>

          {editing ? (
            <ul className="exercise-list">
              {draft.map((ex, exIndex) => (
                <li key={exIndex} className="exercise">
                  <div className="exercise__hd">
                    <label className="edit-box edit-box--name">
                      <input
                        className="edit-box__input"
                        aria-label={`第 ${exIndex + 1} 个动作名称`}
                        value={ex.raw_name}
                        onChange={(e) => renameExercise(exIndex, e.target.value)}
                      />
                    </label>
                    {ex.sets.some((set) => set.isInferred) ? <InferredDot /> : null}
                    <Tip text={draft.length <= 1 ? '至少留一个动作' : '删除动作'}>
                      <button
                        type="button"
                        className="set-tool edit-remove"
                        aria-label={`删除动作（第 ${exIndex + 1} 个）`}
                        disabled={draft.length <= 1}
                        onClick={() => removeExercise(exIndex)}
                      >
                        <CloseIcon size={14} />
                      </button>
                    </Tip>
                  </div>
                  <ul className="set-list">
                    {ex.sets.map((set, setIndex) => (
                      <li
                        key={set.key}
                        ref={(el) => {
                          if (el) rowRefs.current.set(set.key, el);
                          else rowRefs.current.delete(set.key);
                        }}
                        className={
                          dragging?.ex === exIndex && dragging.key === set.key
                            ? 'edit-set is-dragging'
                            : 'edit-set'
                        }
                        data-set-row={setIndex}
                        data-set-key={set.key}
                      >

                        <label className="edit-box">
                          <input
                            className="edit-box__input"
                            aria-label={`第 ${exIndex + 1} 个动作第 ${setIndex + 1} 组重量`}
                            inputMode="decimal"
                            placeholder="—"
                            value={set.weight}
                            onChange={(e) =>
                              patchSet(exIndex, setIndex, { weight: decimalText(e.target.value) })
                            }
                            onFocus={selectAll}
                          />
                          <span className="edit-box__unit">kg</span>
                        </label>
                        <span className="edit-set__x">×</span>
                        <label className="edit-box">
                          <input
                            className="edit-box__input"
                            aria-label={`第 ${exIndex + 1} 个动作第 ${setIndex + 1} 组次数`}
                            inputMode="numeric"
                            placeholder="—"
                            value={set.reps}
                            onChange={(e) =>
                              patchSet(exIndex, setIndex, { reps: onlyDigits(e.target.value) })
                            }
                            onFocus={selectAll}
                          />
                          <span className="edit-box__unit">次</span>
                        </label>
                        {set.drops.map((drop, dropIndex) => (
                          <span key={dropIndex} className="edit-seg">
                            <span className="edit-set__x">+</span>
                            {drop.weight !== '' ? (
                              <>
                                <label className="edit-box edit-box--drop">
                                  <input
                                    className="edit-box__input"
                                    aria-label={`第 ${exIndex + 1} 个动作第 ${setIndex + 1} 组后续第 ${dropIndex + 1} 段重量`}
                                    inputMode="decimal"
                                    placeholder="—"
                                    value={drop.weight}
                                    onChange={(e) =>
                                      patchDrop(exIndex, setIndex, dropIndex, {
                                        weight: decimalText(e.target.value),
                                      })
                                    }
                                    onFocus={selectAll}
                                  />
                                  <span className="edit-box__unit">kg</span>
                                </label>
                                <span className="edit-set__x">×</span>
                              </>
                            ) : null}
                            <label className="edit-box edit-box--drop">
                              <input
                                className="edit-box__input"
                                aria-label={`第 ${exIndex + 1} 个动作第 ${setIndex + 1} 组后续第 ${dropIndex + 1} 段次数`}
                                inputMode="numeric"
                                placeholder="—"
                                value={drop.reps}
                                onChange={(e) =>
                                  patchDrop(exIndex, setIndex, dropIndex, {
                                    reps: onlyDigits(e.target.value),
                                  })
                                }
                                onFocus={selectAll}
                              />
                              <span className="edit-box__unit">次</span>
                            </label>
                          </span>
                        ))}
                        {set.setType === 'warmup' ? <span className="tag">热身</span> : null}
                        <span className="edit-set__tools">
                          <span className="set-menu">
                            <Tip text="组操作" align="end" hidden={menu?.key === set.key}>
                              <button
                                type="button"
                                className="set-tool set-menu-trigger"
                                aria-label={`组操作（第 ${setIndex + 1} 组）`}
                                aria-haspopup="menu"
                                aria-expanded={menu?.key === set.key}
                                onClick={() =>
                                  setMenu((prev) =>
                                    prev?.key === set.key ? null : { ex: exIndex, key: set.key },
                                  )
                                }
                              >
                                <EllipsisIcon size={16} />
                              </button>
                            </Tip>
                            {menu?.key === set.key ? (
                              <div className="set-menu__panel" role="menu" ref={menuRef}>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    duplicateSet(exIndex, setIndex);
                                    setMenu(null);
                                  }}
                                >
                                  <CopyIcon />
                                  复制组
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="is-danger"
                                  disabled={ex.sets.length <= 1}
                                  onClick={() => {
                                    removeSet(exIndex, setIndex);
                                    setMenu(null);
                                  }}
                                >
                                  <TrashIcon size={14} />
                                  删除组
                                </button>
                              </div>
                            ) : null}
                          </span>
                          <Tip text="拖动排序" align="end">
                            <button
                              type="button"
                              className="set-tool set-tool--drag"
                              aria-label={`拖动排序（第 ${setIndex + 1} 组）`}
                              onPointerDown={(e) => startDrag(e, exIndex, set.key)}
                              onPointerMove={moveDrag}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                            >
                              <DragHandleIcon />
                            </button>
                          </Tip>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="exercise-list">
              {detail.exercises.map((ex, exIndex) => (
                <li key={`${ex.raw_name}-${exIndex}`} className="exercise">
                  <div className="exercise__name">
                    {ex.raw_name}
                    {ex.sets.some((set) => set.is_inferred) ? <InferredDot /> : null}
                  </div>
                  <ul className="set-list">
                    {ex.sets.map((set, i) => {
                      const segments = setSegments(set);
                      return (
                        <li key={i}>
                          {segments.map((seg, k) => (
                            <span key={k}>
                              {k > 0 ? <span className="set-plus"> + </span> : null}
                              {k === 0 || seg.weight !== segments[k - 1]?.weight
                                ? `${seg.weight === null ? '—' : formatKg(seg.weight)} × `
                                : null}
                              {seg.reps === null ? '—' : seg.reps}
                            </span>
                          ))}
                          {set.set_type === 'warmup' ? <span className="tag">热身</span> : null}
                          {set.tags?.includes('drop') ? (
                            <span className="tag">递减组</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {detail.missing_fields.length > 0 ? (
            <p className="page-hint">
              还缺：{detail.missing_fields.map((f) => MISSING_LABELS[f] ?? f).join('、')}
              {editing ? ' —— 改完保存即可补上' : ' —— 回到会话页可以补'}
            </p>
          ) : null}
          {detail.note ? <p className="card-meta">备注：{detail.note}</p> : null}
          {editing ? (
            unrecognizedHint(draft)
          ) : detail.volume.unrecognized_exercises > 0 ? (
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