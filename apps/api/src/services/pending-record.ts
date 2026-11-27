import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { pendingRecord } from '../db/schema.js';
import type { PendingContext } from '../extraction/pending.js';
import { toLocalDate } from '../extraction/dates.js';
import { markRestInTx } from './day-state.js';
import { getDb } from './pool.js';

/**
 * 待补记录槽 —— 「提到了但没记完」的跨轮状态。
 * 一天最多一条；补出训练 / 标休息 / 用户忽略都会把它收敛。
 */

export type PendingSource = 'mentioned' | 'gap';
export type PendingStatus = 'open' | 'filled' | 'rest' | 'dismissed';

export interface Pending {
  id: string;
  target_date: string;
  split_label: string | null;
  source: PendingSource;
  status: PendingStatus;
  session_id: string | null;
}

type Row = {
  id: string;
  targetDate: string;
  splitLabel: string | null;
  source: string;
  status: string;
  sessionId: string | null;
};

function toPending(row: Row): Pending {
  return {
    id: row.id,
    target_date: row.targetDate,
    split_label: row.splitLabel,
    source: row.source === 'mentioned' ? 'mentioned' : 'gap',
    status:
      row.status === 'filled' || row.status === 'rest' || row.status === 'dismissed'
        ? row.status
        : 'open',
    session_id: row.sessionId,
  };
}

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** 用户提到某天练了，但没给动作 / 组数。 */
export async function rememberMention(input: {
  user_id: string;
  target_date: string;
  split_label: string | null;
}): Promise<Pending> {
  const [row] = await getDb()
    .insert(pendingRecord)
    .values({
      userId: input.user_id,
      targetDate: input.target_date,
      splitLabel: input.split_label,
      source: 'mentioned',
      status: 'open',
    })
    .onConflictDoUpdate({
      target: [pendingRecord.userId, pendingRecord.targetDate],
      set: {
        splitLabel: sql`coalesce(excluded.split_label, ${pendingRecord.splitLabel})`,
        source: 'mentioned',
        // 已经补出训练 / 标过休息的，不因一句提及重新打开
        status: sql`case when ${pendingRecord.status} in ('filled', 'rest') then ${pendingRecord.status} else 'open' end`,
        resolvedAt: sql`case when ${pendingRecord.status} in ('filled', 'rest') then ${pendingRecord.resolvedAt} else null end`,
      },
    })
    .returning();
  if (!row) throw new Error('pending_record upsert 没有返回行');
  return toPending(row);
}

/** 记录后发现的空白日；已有行（含 dismissed）不重复建。 */
export async function rememberGap(input: {
  user_id: string;
  target_date: string;
}): Promise<Pending | null> {
  const db = getDb();
  const existing = await db
    .select()
    .from(pendingRecord)
    .where(
      and(eq(pendingRecord.userId, input.user_id), eq(pendingRecord.targetDate, input.target_date)),
    )
    .limit(1);
  if (existing[0]) {
    return existing[0].status === 'open' ? toPending(existing[0]) : null;
  }

  const [row] = await db
    .insert(pendingRecord)
    .values({
      userId: input.user_id,
      targetDate: input.target_date,
      splitLabel: null,
      source: 'gap',
      status: 'open',
    })
    .onConflictDoNothing()
    .returning();
  return row ? toPending(row) : null;
}

/** 最近 3 天内、今天之前的 open 槽；补记提示用。 */
export async function nextPending(input: {
  user_id: string;
  before_date: string;
  max_age_days?: number;
}): Promise<Pending | null> {
  const maxAge = input.max_age_days ?? 3;
  const from = addDays(input.before_date, -maxAge);
  const rows = await getDb()
    .select()
    .from(pendingRecord)
    .where(
      and(
        eq(pendingRecord.userId, input.user_id),
        eq(pendingRecord.status, 'open'),
        lt(pendingRecord.targetDate, input.before_date),
        gte(pendingRecord.targetDate, from),
      ),
    )
    .orderBy(desc(pendingRecord.targetDate))
    .limit(1);
  return rows[0] ? toPending(rows[0]) : null;
}

/** 图前上下文：包含「今天」的槽，供无日期补细节绑定。 */
export async function pendingContextForExtraction(input: {
  user_id: string;
  today: string;
  max_age_days?: number;
}): Promise<PendingContext | null> {
  const pending = await nextPending({
    user_id: input.user_id,
    before_date: addDays(input.today, 1),
    max_age_days: input.max_age_days ?? 3,
  });
  if (!pending) return null;
  return {
    id: pending.id,
    target_date: pending.target_date,
    split_label: pending.split_label,
  };
}

export async function getPendingById(input: {
  user_id: string;
  id: string;
}): Promise<Pending | null> {
  const rows = await getDb()
    .select()
    .from(pendingRecord)
    .where(and(eq(pendingRecord.id, input.id), eq(pendingRecord.userId, input.user_id)))
    .limit(1);
  return rows[0] ? toPending(rows[0]) : null;
}

export async function getPendingByDate(input: {
  user_id: string;
  date: string;
}): Promise<Pending | null> {
  const rows = await getDb()
    .select()
    .from(pendingRecord)
    .where(
      and(eq(pendingRecord.userId, input.user_id), eq(pendingRecord.targetDate, input.date)),
    )
    .limit(1);
  return rows[0] ? toPending(rows[0]) : null;
}

export async function resolveDismissed(input: {
  user_id: string;
  id: string;
}): Promise<boolean> {
  const rows = await getDb()
    .update(pendingRecord)
    .set({ status: 'dismissed', resolvedAt: new Date() })
    .where(and(eq(pendingRecord.id, input.id), eq(pendingRecord.userId, input.user_id)))
    .returning({ id: pendingRecord.id });
  return rows.length > 0;
}

/** 休息与 day_status 写在同一个事务里。 */
export async function resolveRest(input: { user_id: string; id: string }): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(pendingRecord)
      .where(and(eq(pendingRecord.id, input.id), eq(pendingRecord.userId, input.user_id)))
      .limit(1);
    const pending = rows[0];
    if (!pending) return false;

    // 训练优先：如果目标日已有 session，markRest 会返回 conflict，pending 也按 filled 收敛
    const marked = await markRestInTx(tx, {
      user_id: input.user_id,
      dates: [pending.targetDate],
      reason: null,
      source: 'user',
    });
    await tx
      .update(pendingRecord)
      .set({
        status: marked.conflicts.includes(pending.targetDate) ? 'filled' : 'rest',
        resolvedAt: new Date(),
      })
      .where(and(eq(pendingRecord.id, input.id), eq(pendingRecord.userId, input.user_id)));
    return true;
  });
}

/** 训练落库后收敛该日期的槽；open / dismissed / rest 都转 filled。 */
export async function markFilledForDate(input: {
  user_id: string;
  date: string;
  session_id: string;
}): Promise<void> {
  await getDb()
    .update(pendingRecord)
    .set({ status: 'filled', sessionId: input.session_id, resolvedAt: new Date() })
    .where(
      and(
        eq(pendingRecord.userId, input.user_id),
        eq(pendingRecord.targetDate, input.date),
        inArray(pendingRecord.status, ['open', 'dismissed', 'rest']),
      ),
    );
}
