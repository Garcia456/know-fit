/**
 * 时间状语 → date —— 纯确定性，LLM 只出原文。
 *
 * 认：「今天 / 昨天 / 前天」、`YYYY-MM-DD`、`YYYY年M月D号`、`M月D号`、`D号`。
 * day-only 的「30号」按 reference 的年月算（改日期时以原训练月为锚），没有 reference 才用当月。
 * 认不出来返回 null —— 录入侧按今天兜底，修改侧由调用方决定是否追问。
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

/** 回填校验：2 月 30 号这种不存在的日期返回 null，不让 Date 自动进位 */
function makeDate(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return toLocalDate(d);
}

export function tryResolveDate(
  dayHint: string | null,
  now: Date = new Date(),
  reference: string | null = null,
): string | null {
  const hint = dayHint?.replace(/\s+/g, '') ?? '';
  if (!hint) return null;

  const iso = hint.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const full = hint.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[号日]?/);
  if (full) {
    return makeDate(full[1] ? Number(full[1]) : now.getFullYear(), Number(full[2]), Number(full[3]));
  }

  const dayOnly = hint.match(/^(\d{1,2})[号日]$/);
  if (dayOnly) {
    const [y, m] = reference
      ? reference.split('-').map(Number)
      : [now.getFullYear(), now.getMonth() + 1];
    return makeDate(y!, m!, Number(dayOnly[1]));
  }

  const hit = OFFSETS.find((o) => o.keywords.some((k) => hint.includes(k)));
  if (hit) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() + hit.days);
    return toLocalDate(d);
  }
  return null;
}

/** 录入侧：认不出按今天算 —— 记错一天比拦住录入轻。修改侧请用 tryResolveDate。 */
export function resolveDate(dayHint: string | null, now: Date = new Date()): string {
  return tryResolveDate(dayHint, now) ?? toLocalDate(now);
}