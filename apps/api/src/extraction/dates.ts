/**
 * 时间状语 → date —— 纯确定性，LLM 只出原文。
 *
 * v1 只认「今天 / 昨天 / 前天」这一小组关键词（🔴 推断，够 MVP 用）。
 * 认不出来一律按今天算 —— 记错一天比拦住录入轻。
 */
const OFFSETS: { keywords: string[]; days: number }[] = [
  { keywords: ['前天'], days: -2 },
  { keywords: ['昨天', '昨日', '昨'], days: -1 },
  { keywords: ['今天', '今日', '刚刚', '刚才', '今'], days: 0 },
];

/** 用本地时区拼 'YYYY-MM-DD'，不走 toISOString（那是 UTC，会差一天） */
export function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 整月差（只看年月）；开始晚于当前月按 0 算。 */
export function monthsSince(startDate: string, now: Date): number {
  const [y, m] = startDate.split('-').map(Number);
  if (!y || !m) return 0;
  return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m));
}

export function resolveDate(dayHint: string | null, now: Date = new Date()): string {
  const hint = dayHint?.trim() ?? '';
  const hit = OFFSETS.find((o) => o.keywords.some((k) => hint.includes(k)));
  const days = hit?.days ?? 0;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}