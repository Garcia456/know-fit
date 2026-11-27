import { and, eq } from 'drizzle-orm';
import type { BackfillPrompt } from '../contracts/turn.js';
import { recoveryNudge } from '../db/schema.js';
import { toLocalDate } from '../extraction/dates.js';
import { getDayStatus, markUnlogged } from './day-state.js';
import {
  getPendingByDate,
  nextPending,
  rememberGap,
  resolveDismissed,
  resolveRest,
  type Pending,
} from './pending-record.js';
import { getDb } from './pool.js';

/**
 * 记录完今天之后，最多给一个「补昨天」提示。
 * 候选优先 pending（用户提到过），其次昨天空白（gap）。
 */

export type BackfillAction = '补记' | '休息' | '忽略' | '未响应';

export interface BackfillActionOk {
  ok: true;
  prefill?: { target_date: string; split_label: string | null };
}

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

async function claimBackfill(input: {
  user_id: string;
  target_date: string;
}): Promise<string | null> {
  const rows = await getDb()
    .insert(recoveryNudge)
    .values({
      userId: input.user_id,
      sessionId: null,
      targetDate: input.target_date,
      type: '补记',
      action: null,
    })
    .onConflictDoNothing()
    .returning({ id: recoveryNudge.id });
  return rows[0]?.id ?? null;
}

function toPrompt(pending: Pending, nudgeId: string): BackfillPrompt {
  return {
    nudge_id: nudgeId,
    pending_id: pending.id,
    target_date: pending.target_date,
    split_label: pending.split_label,
    source: pending.source,
    message_code: pending.source,
  };
}

export async function backfillFor(input: {
  user_id: string;
  session_date: string;
  today: string;
}): Promise<BackfillPrompt | null> {
  // 只在「今天记完」之后提示；用户正在补别的日期时不打扰
  if (input.session_date !== input.today) return null;

  let pending = await nextPending({ user_id: input.user_id, before_date: input.today });
  if (pending) {
    // 目标日已经被训练 / 休息收敛的旧槽不再提示
    const state = await getDayStatus(input.user_id, pending.target_date);
    if (state === 'trained' || state === 'rest') return null;
  }
  if (!pending) {
    const yesterday = addDays(input.today, -1);
    if ((await getDayStatus(input.user_id, yesterday)) !== 'unknown') return null;
    pending = await rememberGap({ user_id: input.user_id, target_date: yesterday });
  }
  if (!pending) return null;

  const nudgeId = await claimBackfill({
    user_id: input.user_id,
    target_date: pending.target_date,
  });
  // 冲突 = 这个日期已经提示过（补记 / 休息 / 忽略都算），不再重复
  if (!nudgeId) return null;

  return toPrompt(pending, nudgeId);
}

export async function applyBackfillAction(input: {
  user_id: string;
  nudge_id: string;
  action: BackfillAction;
}): Promise<BackfillActionOk | null> {
  const db = getDb();
  const nudges = await db
    .select({ id: recoveryNudge.id, targetDate: recoveryNudge.targetDate })
    .from(recoveryNudge)
    .where(
      and(
        eq(recoveryNudge.id, input.nudge_id),
        eq(recoveryNudge.userId, input.user_id),
        eq(recoveryNudge.type, '补记'),
      ),
    )
    .limit(1);
  const nudge = nudges[0];
  if (!nudge?.targetDate) return null;

  const pending = await getPendingByDate({
    user_id: input.user_id,
    date: nudge.targetDate,
  });
  if (!pending) return null;

  await db
    .update(recoveryNudge)
    .set({ action: input.action })
    .where(and(eq(recoveryNudge.id, nudge.id), eq(recoveryNudge.userId, input.user_id)));

  if (input.action === '补记') {
    // 用户说“练了没记”：先把那天标成漏记；补出训练时 persistWorkout 会清掉这个标记
    await markUnlogged({ user_id: input.user_id, date: pending.target_date });
    return {
      ok: true,
      prefill: { target_date: pending.target_date, split_label: pending.split_label },
    };
  }
  if (input.action === '休息') {
    await resolveRest({ user_id: input.user_id, id: pending.id });
    return { ok: true };
  }
  if (input.action === '忽略') {
    await resolveDismissed({ user_id: input.user_id, id: pending.id });
    return { ok: true };
  }
  return { ok: true };
}
