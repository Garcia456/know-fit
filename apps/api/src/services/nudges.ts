import { and, asc, desc, eq } from 'drizzle-orm';
import type { Nudge, NudgeAction } from '../contracts/sessions.js';
import { recoveryNudge, workoutSession } from '../db/schema.js';
import { toLocalDate } from '../extraction/dates.js';
import { getDb } from './pool.js';

/**
 * F7 提示 —— 阈值由后端算，前端不自算。
 * 同一断点只出现一次：靠 (user_id, type, session_id) 唯一键兜底。
 */

const DEFAULT_THRESHOLD_DAYS = 7;
const MIN_THRESHOLD_DAYS = 7;
const MAX_THRESHOLD_DAYS = 14;
const WINDOW_DAYS = 28;

/** 两个 'YYYY-MM-DD' 之间差几天；按 UTC 拼，避开夏令时 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** 近 4 周平均间隔 × 2，夹在 7–14 天；间隔不足 2 个就按默认 7 天 */
export function nudgeThresholdDays(gaps: number[]): number {
  const valid = gaps.filter((g) => Number.isFinite(g) && g > 0);
  if (valid.length < 2) return DEFAULT_THRESHOLD_DAYS;
  const avg = valid.reduce((sum, g) => sum + g, 0) / valid.length;
  return Math.min(MAX_THRESHOLD_DAYS, Math.max(MIN_THRESHOLD_DAYS, Math.round(avg * 2)));
}

/** 日期升序的训练日 → 相邻间隔（同一天多次只算一个点） */
export function gapsBetween(dates: string[]): number[] {
  const unique = [...new Set(dates)].sort();
  const gaps: number[] = [];
  for (let i = 1; i < unique.length; i++) {
    gaps.push(daysBetween(unique[i - 1]!, unique[i]!));
  }
  return gaps;
}

async function claim(input: {
  user_id: string;
  type: '补全' | '断流';
  session_id: string;
  message: string;
}): Promise<Nudge | null> {
  const rows = await getDb()
    .insert(recoveryNudge)
    .values({
      userId: input.user_id,
      type: input.type,
      sessionId: input.session_id,
      action: null,
    })
    .onConflictDoNothing()
    .returning({ id: recoveryNudge.id });
  const created = rows[0];
  // 冲突 = 这个断点已经提示过，不再返回（服务端也拒绝重复）
  if (!created) return null;
  return {
    id: created.id,
    type: input.type,
    session_id: input.session_id,
    message: input.message,
  };
}

export async function nextNudge(input: {
  user_id: string;
  now?: Date;
}): Promise<Nudge | null> {
  const db = getDb();
  const now = input.now ?? new Date();
  const today = toLocalDate(now);

  // ① 补全优先：最近一条没记完的训练
  const incomplete = await db
    .select()
    .from(workoutSession)
    .where(
      and(eq(workoutSession.userId, input.user_id), eq(workoutSession.status, 'incomplete')),
    )
    .orderBy(desc(workoutSession.date), desc(workoutSession.createdAt))
    .limit(1);
  const pending = incomplete[0];
  if (pending) {
    const split = pending.splitLabel ? `${pending.splitLabel}` : '上次训练';
    return claim({
      user_id: input.user_id,
      type: '补全',
      session_id: pending.id,
      message: `${split}好像没记完，补上？`,
    });
  }

  // ② 断流：距上次训练超过 N 天
  const recent = await db
    .select({ id: workoutSession.id, date: workoutSession.date })
    .from(workoutSession)
    .where(eq(workoutSession.userId, input.user_id))
    .orderBy(asc(workoutSession.date), asc(workoutSession.createdAt));
  const last = recent[recent.length - 1];
  if (!last) return null;

  const windowStart = toLocalDate(new Date(now.getTime() - WINDOW_DAYS * 86_400_000));
  const inWindow = recent.filter((s) => s.date >= windowStart).map((s) => s.date);
  const threshold = nudgeThresholdDays(gapsBetween(inWindow));

  const idle = daysBetween(last.date, today);
  if (idle < threshold) return null;

  return claim({
    user_id: input.user_id,
    type: '断流',
    session_id: last.id,
    message: `上次训练是 ${idle} 天前`,
  });
}

/** 记用户对提示的动作；提示不存在（或不属于这个用户）返回 false */
export async function recordNudgeAction(input: {
  user_id: string;
  nudge_id: string;
  action: NudgeAction['action'];
}): Promise<boolean> {
  const rows = await getDb()
    .update(recoveryNudge)
    .set({ action: input.action })
    .where(
      and(eq(recoveryNudge.id, input.nudge_id), eq(recoveryNudge.userId, input.user_id)),
    )
    .returning({ id: recoveryNudge.id });
  return rows.length > 0;
}