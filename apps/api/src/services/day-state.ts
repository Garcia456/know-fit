import { and, eq, gte, lte } from 'drizzle-orm';
import { dayStatus, workoutSession } from '../db/schema.js';
import { getDb } from './pool.js';

/**
 * 某一天的四种状态：练了 / 明确休息 / 练了没记 / 不知道。
 * `trained` 由 workout_session 推导；`day_status` 只存后两种；`unknown` 不落行。
 */

export type DayState = 'trained' | 'rest' | 'unlogged' | 'unknown';
export type DayReason = 'planned_rest' | 'deload' | 'sick' | 'travel' | 'busy' | 'other';
export type DaySource = 'user' | 'plan' | 'import';

export interface DayStateRow {
  date: string;
  state: DayState;
  reason: DayReason | null;
}

export type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export function deriveDayState(input: {
  hasSession: boolean;
  status: 'rest' | 'unlogged' | null;
}): DayState {
  if (input.hasSession) return 'trained';
  return input.status ?? 'unknown';
}

async function hasSessionOn(userId: string, dateKey: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: workoutSession.id })
    .from(workoutSession)
    .where(and(eq(workoutSession.userId, userId), eq(workoutSession.date, dateKey)))
    .limit(1);
  return rows.length > 0;
}

export async function getDayStatus(userId: string, dateKey: string): Promise<DayState> {
  if (await hasSessionOn(userId, dateKey)) return 'trained';

  const rows = await getDb()
    .select({ status: dayStatus.status })
    .from(dayStatus)
    .where(and(eq(dayStatus.userId, userId), eq(dayStatus.date, dateKey)))
    .limit(1);
  const status = rows[0]?.status;
  return deriveDayState({ hasSession: false, status: status === 'rest' || status === 'unlogged' ? status : null });
}

/** 日历 / 统计读：只返回有训练或有标记的日期，缺失日期由调用方当 unknown。 */
export async function listDayStates(input: {
  user_id: string;
  from: string;
  to: string;
}): Promise<Map<string, DayStateRow>> {
  const db = getDb();
  const sessions = await db
    .selectDistinct({ date: workoutSession.date })
    .from(workoutSession)
    .where(
      and(
        eq(workoutSession.userId, input.user_id),
        gte(workoutSession.date, input.from),
        lte(workoutSession.date, input.to),
      ),
    );
  const marks = await db
    .select({ date: dayStatus.date, status: dayStatus.status, reason: dayStatus.reason })
    .from(dayStatus)
    .where(
      and(
        eq(dayStatus.userId, input.user_id),
        gte(dayStatus.date, input.from),
        lte(dayStatus.date, input.to),
      ),
    );

  const out = new Map<string, DayStateRow>();
  for (const mark of marks) {
    const status = mark.status === 'rest' || mark.status === 'unlogged' ? mark.status : null;
    out.set(mark.date, {
      date: mark.date,
      state: deriveDayState({ hasSession: false, status }),
      reason: toReason(mark.reason),
    });
  }
  for (const session of sessions) {
    out.set(session.date, { date: session.date, state: 'trained', reason: null });
  }
  return out;
}

function toReason(value: string | null): DayReason | null {
  return value === 'planned_rest' || value === 'deload' || value === 'sick' || value === 'travel' || value === 'busy' || value === 'other'
    ? value
    : null;
}

export async function markRestInTx(
  tx: Tx,
  input: { user_id: string; dates: string[]; reason: DayReason | null; source: DaySource },
): Promise<{ written: string[]; conflicts: string[] }> {
  const written: string[] = [];
  const conflicts: string[] = [];

  for (const dateKey of [...new Set(input.dates)]) {
    const sessions = await tx
      .select({ id: workoutSession.id })
      .from(workoutSession)
      .where(and(eq(workoutSession.userId, input.user_id), eq(workoutSession.date, dateKey)))
      .limit(1);
    if (sessions.length > 0) {
      conflicts.push(dateKey);
      continue;
    }

    await tx
      .insert(dayStatus)
      .values({
        userId: input.user_id,
        date: dateKey,
        status: 'rest',
        reason: input.reason,
        source: input.source,
      })
      .onConflictDoUpdate({
        target: [dayStatus.userId, dayStatus.date],
        set: {
          status: 'rest',
          reason: input.reason,
          source: input.source,
          updatedAt: new Date(),
        },
      });
    written.push(dateKey);
  }

  return { written, conflicts };
}

export async function markRest(input: {
  user_id: string;
  dates: string[];
  reason?: DayReason | null;
  source?: DaySource;
}): Promise<{ written: string[]; conflicts: string[] }> {
  return getDb().transaction((tx) =>
    markRestInTx(tx, {
      user_id: input.user_id,
      dates: input.dates,
      reason: input.reason ?? null,
      source: input.source ?? 'user',
    }),
  );
}

export async function markUnlogged(input: {
  user_id: string;
  date: string;
  source?: DaySource;
}): Promise<{ written: boolean }> {
  if (await hasSessionOn(input.user_id, input.date)) return { written: false };

  await getDb()
    .insert(dayStatus)
    .values({
      userId: input.user_id,
      date: input.date,
      status: 'unlogged',
      reason: null,
      source: input.source ?? 'user',
    })
    .onConflictDoUpdate({
      target: [dayStatus.userId, dayStatus.date],
      set: {
        status: 'unlogged',
        reason: null,
        source: input.source ?? 'user',
        updatedAt: new Date(),
      },
    });

  return { written: true };
}

export async function clearDayStatus(userId: string, dateKey: string): Promise<void> {
  await getDb()
    .delete(dayStatus)
    .where(and(eq(dayStatus.userId, userId), eq(dayStatus.date, dateKey)));
}
