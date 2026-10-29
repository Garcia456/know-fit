import { parseDateKey } from './calendar';

/** 秒 → mm:ss；无效值显示破折号，不编造 0:00。 */
export function formatMmSs(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** 引用时间点：不足 1 秒没法定位，返回 null 让调用方不显示 */
export function formatCitationTs(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 1) return null;
  return formatMmSs(seconds);
}

const kgFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

export function formatKg(value: number): string {
  return `${kgFormatter.format(value)} kg`;
}

/** 只出数字，单位由调用方排版 */
export function formatNumber(value: number): string {
  return kgFormatter.format(value);
}

/** 环比差值；基线缺失时不显示百分比（调用方先判 null）。 */
export function formatDeltaPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${kgFormatter.format(value)}%`;
}

/** '2026-10-08' → '10 月 8 日'；非法日期原样返回，不编一个。 */
export function formatMonthDay(key: string): string {
  const d = parseDateKey(key);
  if (!d) return key;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** '2026-10-08' → '10/8'（图表轴标签） */
export function formatMd(key: string): string {
  const d = parseDateKey(key);
  if (!d) return key;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 带符号的公斤差值 */
export function formatSignedKg(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${kgFormatter.format(value)} kg`;
}