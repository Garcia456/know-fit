/** 日历只做一件事：把「某个月」铺成周一开头的格子。 */

/** 本地时区拼 'YYYY-MM-DD'（toISOString 是 UTC，会差一天） */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 2026-13-01 会被 Date 顺延到次年 —— 回读组件对不上就按非法处理
  if (Number.isNaN(d.getTime()) || toDateKey(d) !== key) return null;
  return d;
}

/** 所在自然周的周一（周一为一周起点） */
export function startOfWeekKey(d: Date): string {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return toDateKey(c);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/** 整月查询区间（含首尾） */
export function monthRange(d: Date): { from: string; to: string } {
  const first = startOfMonth(d);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: toDateKey(first), to: toDateKey(last) };
}

/**
 * 周一开头的格子；非本月的位置是 null（不显示上下月，避免误点）。
 *
 * 默认补满 6 周（42 格）：一个月的行数在 4–6 之间浮动，不补满的话每页高度不同，
 * 翻月时日历盒子会忽高忽低。主流日历库都这么做 —— react-day-picker 的 `fixedWeeks`、
 * MUI X 的 `fixedWeekNumber={6}`。
 */
export function monthGrid(d: Date, fixedWeeks = true): (string | null)[] {
  const first = startOfMonth(d);
  const leading = (first.getDay() + 6) % 7;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= days; day++) {
    cells.push(toDateKey(new Date(d.getFullYear(), d.getMonth(), day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  if (fixedWeeks) {
    while (cells.length < 42) cells.push(null);
  }
  return cells;
}