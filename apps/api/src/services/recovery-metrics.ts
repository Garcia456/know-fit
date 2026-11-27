import { and, gte, inArray, lte } from 'drizzle-orm';
import { pendingRecord, recoveryNudge, workoutSession } from '../db/schema.js';
import { toLocalDate } from '../extraction/dates.js';
import { getDb } from './pool.js';

/**
 * 断点恢复率 —— 只读指标，不修改业务表。
 * 新断点（mentioned / gap）有完整恢复口径；补全 / 断流只做 legacy 计数。
 */

export interface RecoveryMetricSlice {
  detected: number;
  prompted: number;
  training_recovered: number;
  data_resolved: number;
  dismissed: number;
}

export interface RecoveryMetrics {
  from: string;
  to: string;
  breakpoints: RecoveryMetricSlice & { no_response: number };
  rates: {
    training_recovery: number | null;
    data_resolution: number | null;
  };
  by_kind: Record<'mentioned_unlogged' | 'unrecorded_day', RecoveryMetricSlice>;
  by_source: Record<'mentioned' | 'gap', RecoveryMetricSlice>;
  legacy: {
    detected: number;
    prompted: number;
    by_type: Record<string, number>;
  };
}

function emptySlice(): RecoveryMetricSlice {
  return { detected: 0, prompted: 0, training_recovered: 0, data_resolved: 0, dismissed: 0 };
}

export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

function startOfDay(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}

function endOfDay(dateKey: string): Date {
  return new Date(`${dateKey}T23:59:59.999`);
}

export async function recoveryMetrics(input: {
  from: string;
  to: string;
}): Promise<RecoveryMetrics> {
  const db = getDb();
  const from = startOfDay(input.from);
  const to = endOfDay(input.to);

  const pendings = await db
    .select({
      userId: pendingRecord.userId,
      targetDate: pendingRecord.targetDate,
      source: pendingRecord.source,
      status: pendingRecord.status,
    })
    .from(pendingRecord)
    .where(and(gte(pendingRecord.createdAt, from), lte(pendingRecord.createdAt, to)));

  const nudges = await db
    .select({
      userId: recoveryNudge.userId,
      type: recoveryNudge.type,
      targetDate: recoveryNudge.targetDate,
    })
    .from(recoveryNudge)
    .where(and(gte(recoveryNudge.shownAt, from), lte(recoveryNudge.shownAt, to)));

  // 提示按 (user, target_date) 匹配到 pending
  const prompted = new Set(
    nudges
      .filter((n) => n.type === '补记' && n.targetDate)
      .map((n) => `${n.userId}:${n.targetDate}`),
  );

  // 未 filled 的 pending：目标日后 7 天内是否有新训练
  const userIds = [...new Set(pendings.map((p) => p.userId))];
  const pendingDates = pendings.map((p) => p.targetDate).sort();
  const sessions =
    userIds.length > 0 && pendingDates.length > 0
      ? await db
          .select({ userId: workoutSession.userId, date: workoutSession.date })
          .from(workoutSession)
          .where(
            and(
              inArray(workoutSession.userId, userIds),
              gte(workoutSession.date, pendingDates[0]!),
              lte(workoutSession.date, addDays(pendingDates[pendingDates.length - 1]!, 7)),
            ),
          )
      : [];

  const sessionsByUser = new Map<string, string[]>();
  for (const s of sessions) {
    const bucket = sessionsByUser.get(s.userId) ?? [];
    bucket.push(s.date);
    sessionsByUser.set(s.userId, bucket);
  }

  const byKind: RecoveryMetrics['by_kind'] = {
    mentioned_unlogged: emptySlice(),
    unrecorded_day: emptySlice(),
  };
  const bySource: RecoveryMetrics['by_source'] = {
    mentioned: emptySlice(),
    gap: emptySlice(),
  };
  const breakpoints: RecoveryMetrics['breakpoints'] = { ...emptySlice(), no_response: 0 };

  const addTo = (slice: RecoveryMetricSlice, key: keyof RecoveryMetricSlice): void => {
    slice[key] += 1;
  };

  for (const pending of pendings) {
    const kind = pending.source === 'mentioned' ? 'mentioned_unlogged' : 'unrecorded_day';
    const source = pending.source === 'mentioned' ? 'mentioned' : 'gap';
    const wasPrompted = prompted.has(`${pending.userId}:${pending.targetDate}`);
    const sessionWithin7 = (sessionsByUser.get(pending.userId) ?? []).some(
      (date) => date > pending.targetDate && date <= addDays(pending.targetDate, 7),
    );
    const trainingRecovered = pending.status === 'filled' || sessionWithin7;
    const dataResolved = pending.status === 'filled' || pending.status === 'rest';
    const dismissed = pending.status === 'dismissed';

    for (const slice of [breakpoints, byKind[kind], bySource[source]]) {
      addTo(slice, 'detected');
      if (wasPrompted) addTo(slice, 'prompted');
      if (trainingRecovered) addTo(slice, 'training_recovered');
      if (dataResolved) addTo(slice, 'data_resolved');
      if (dismissed) addTo(slice, 'dismissed');
    }
  }

  breakpoints.no_response = Math.max(
    0,
    breakpoints.detected - breakpoints.prompted - breakpoints.dismissed,
  );

  const legacyByType: Record<string, number> = {};
  for (const nudge of nudges) {
    if (nudge.type === '补全' || nudge.type === '断流') {
      legacyByType[nudge.type] = (legacyByType[nudge.type] ?? 0) + 1;
    }
  }
  const legacyDetected = Object.values(legacyByType).reduce((a, b) => a + b, 0);

  return {
    from: input.from,
    to: input.to,
    breakpoints,
    rates: {
      training_recovery: rate(breakpoints.training_recovered, breakpoints.detected),
      data_resolution: rate(breakpoints.data_resolved, breakpoints.detected),
    },
    by_kind: byKind,
    by_source: bySource,
    legacy: {
      detected: legacyDetected,
      prompted: legacyDetected,
      by_type: legacyByType,
    },
  };
}
