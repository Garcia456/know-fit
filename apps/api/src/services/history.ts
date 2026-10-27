import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type {
  HistoryItem,
  PatchSessionRequest,
  SessionDetail,
  SessionExercise,
  SessionListItem,
} from '../contracts/sessions.js';
import type { MissingField } from '../contracts/extraction.js';
import { exerciseEntry, setEntry, workoutSession } from '../db/schema.js';
import { getDb } from './pool.js';
import { buildVolumeHook } from '../metrics/hook.js';
import { computeVolume, type VolumeSet } from '../metrics/volume.js';
import { exerciseNames, prevSameSplitVolume, sessionVolume } from './metrics.js';

/** 日历与某天详情 —— 容量不落库，读时现算。 */

function asMissingFields(values: string[]): MissingField[] {
  return values.filter(
    (f): f is MissingField => f === 'exercises' || f === 'reps' || f === 'weight_kg',
  );
}

/** 对话抽屉用的记录级历史 —— 按日期倒序，容量现算。 */
export async function listHistory(input: {
  user_id: string;
  limit: number;
}): Promise<HistoryItem[]> {
  const db = getDb();
  const sessions = await db
    .select({
      id: workoutSession.id,
      date: workoutSession.date,
      splitLabel: workoutSession.splitLabel,
      status: workoutSession.status,
      missingFields: workoutSession.missingFields,
    })
    .from(workoutSession)
    .where(eq(workoutSession.userId, input.user_id))
    .orderBy(desc(workoutSession.date), desc(workoutSession.createdAt))
    .limit(input.limit);

  if (sessions.length === 0) return [];
  const ids = sessions.map((s) => s.id);

  const entries = await db
    .select({
      id: exerciseEntry.id,
      sessionId: exerciseEntry.sessionId,
      rawName: exerciseEntry.rawName,
      exerciseId: exerciseEntry.exerciseId,
    })
    .from(exerciseEntry)
    .where(inArray(exerciseEntry.sessionId, ids))
    .orderBy(asc(exerciseEntry.order));

  const entrySession = new Map(entries.map((e) => [e.id, e.sessionId]));
  const setRows = entries.length
    ? await db
        .select({
          exerciseEntryId: setEntry.exerciseEntryId,
          weightKg: setEntry.weightKg,
          reps: setEntry.reps,
          setType: setEntry.setType,
          isInferred: setEntry.isInferred,
        })
        .from(setEntry)
        .innerJoin(exerciseEntry, eq(setEntry.exerciseEntryId, exerciseEntry.id))
        .where(inArray(exerciseEntry.sessionId, ids))
        .orderBy(asc(setEntry.order))
    : [];

  const setsBySession = new Map<string, VolumeSet[]>();
  for (const row of setRows) {
    const sessionId = entrySession.get(row.exerciseEntryId);
    if (!sessionId) continue;
    const bucket = setsBySession.get(sessionId) ?? [];
    bucket.push({
      weight_kg: row.weightKg,
      reps: row.reps,
      set_type: row.setType === 'warmup' ? 'warmup' : 'working',
      is_inferred: row.isInferred,
    });
    setsBySession.set(sessionId, bucket);
  }

  const entriesBySession = new Map<string, typeof entries>();
  for (const entry of entries) {
    const bucket = entriesBySession.get(entry.sessionId) ?? [];
    bucket.push(entry);
    entriesBySession.set(entry.sessionId, bucket);
  }

  const names = exerciseNames();
  return sessions.map((session) => {
    const summary = computeVolume(setsBySession.get(session.id) ?? []);
    const sessionEntries = entriesBySession.get(session.id) ?? [];
    return {
      session_id: session.id,
      date: session.date,
      split_label: session.splitLabel,
      status: session.status === 'complete' ? 'complete' : 'incomplete',
      missing_fields: asMissingFields(session.missingFields),
      exercise_count: sessionEntries.length,
      working_sets: summary.working_sets,
      volume_kg: summary.total_kg,
      exercise_names: sessionEntries.map(
        (e) => (e.exerciseId ? names.get(e.exerciseId) : null) ?? e.rawName,
      ),
    };
  });
}

export async function listSessions(input: {
  user_id: string;
  from: string;
  to: string;
}): Promise<SessionListItem[]> {
  const rows = await getDb()
    .select({
      id: workoutSession.id,
      date: workoutSession.date,
      splitLabel: workoutSession.splitLabel,
      status: workoutSession.status,
    })
    .from(workoutSession)
    .where(
      and(
        eq(workoutSession.userId, input.user_id),
        gte(workoutSession.date, input.from),
        lte(workoutSession.date, input.to),
      ),
    )
    .orderBy(asc(workoutSession.date), asc(workoutSession.createdAt));

  return rows.map((row) => ({
    session_id: row.id,
    date: row.date,
    split_label: row.splitLabel,
    status: row.status === 'complete' ? 'complete' : 'incomplete',
  }));
}

export async function getSessionDetail(input: {
  user_id: string;
  session_id: string;
}): Promise<SessionDetail | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(workoutSession)
    .where(and(eq(workoutSession.id, input.session_id), eq(workoutSession.userId, input.user_id)))
    .limit(1);
  const session = rows[0];
  if (!session) return null;

  const entries = await db
    .select()
    .from(exerciseEntry)
    .where(eq(exerciseEntry.sessionId, session.id))
    .orderBy(asc(exerciseEntry.order));

  const sets = entries.length
    ? await db
        .select()
        .from(setEntry)
        .innerJoin(exerciseEntry, eq(setEntry.exerciseEntryId, exerciseEntry.id))
        .where(eq(exerciseEntry.sessionId, session.id))
        .orderBy(asc(setEntry.order))
    : [];

  const byEntry = new Map<string, SessionExercise['sets']>();
  for (const row of sets) {
    const bucket = byEntry.get(row.set_entry.exerciseEntryId) ?? [];
    bucket.push({
      weight_kg: row.set_entry.weightKg,
      reps: row.set_entry.reps,
      set_type: row.set_entry.setType === 'warmup' ? 'warmup' : 'working',
      is_inferred: row.set_entry.isInferred,
    });
    byEntry.set(row.set_entry.exerciseEntryId, bucket);
  }

  const names = exerciseNames();
  const volume = await sessionVolume({ user_id: input.user_id, session_id: session.id });
  if (!volume) return null;

  const baseline = await prevSameSplitVolume({
    user_id: input.user_id,
    split_label: session.splitLabel,
    exclude_session_id: session.id,
  });

  return {
    session_id: session.id,
    date: session.date,
    split_label: session.splitLabel,
    status: session.status === 'complete' ? 'complete' : 'incomplete',
    missing_fields: asMissingFields(session.missingFields),
    note: session.notes,
    exercises: entries.map((entry) => ({
      raw_name: entry.rawName,
      exercise_id: entry.exerciseId,
      name_zh: entry.exerciseId ? (names.get(entry.exerciseId) ?? null) : null,
      region_fallback: entry.regionFallback,
      name_confidence:
        entry.nameConfidence === 'high' || entry.nameConfidence === 'low'
          ? entry.nameConfidence
          : null,
      sets: byEntry.get(entry.id) ?? [],
    })),
    volume,
    hook: buildVolumeHook({
      current: volume.total_volume_kg,
      baseline,
      split_label: session.splitLabel,
    }),
  };
}

/**
 * F7 追加式补全：只往已有记录里加组 / 补备注，不删除、不覆盖。
 * 已完整的记录拒绝追加 —— 那是编辑，不是补全。
 */
export async function appendToSession(input: {
  user_id: string;
  session_id: string;
  patch: PatchSessionRequest;
}): Promise<SessionDetail | 'not_found' | 'complete'> {
  const db = getDb();
  const found = await db
    .select()
    .from(workoutSession)
    .where(and(eq(workoutSession.id, input.session_id), eq(workoutSession.userId, input.user_id)))
    .limit(1);
  const session = found[0];
  if (!session) return 'not_found';
  if (session.status === 'complete') return 'complete';

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(exerciseEntry)
      .where(eq(exerciseEntry.sessionId, session.id))
      .orderBy(asc(exerciseEntry.order));

    let nextOrder = existing.reduce((max, e) => Math.max(max, e.order), -1) + 1;

    for (const patchExercise of input.patch.exercises) {
      const match = existing.find((e) => e.rawName === patchExercise.raw_name);
      let entryId: string;

      if (match) {
        entryId = match.id;
        const existingSets = await tx
          .select()
          .from(setEntry)
          .where(eq(setEntry.exerciseEntryId, entryId))
          .orderBy(asc(setEntry.order));

        // 先补空值（null → 值，不算覆盖），补不进去的才作为新组追加
        const queue = [...patchExercise.sets];
        for (const set of existingSets) {
          const patchSet = queue[0];
          if (!patchSet) break;
          if (set.weightKg !== null && set.reps !== null) continue;

          const weightKg = set.weightKg ?? patchSet.weight_kg;
          const reps = set.reps ?? patchSet.reps;
          if (weightKg === set.weightKg && reps === set.reps) continue;

          await tx.update(setEntry).set({ weightKg, reps }).where(eq(setEntry.id, set.id));
          queue.shift();
        }

        if (queue.length > 0) {
          let setOrder = existingSets.reduce((max, s) => Math.max(max, s.order), -1) + 1;
          await tx.insert(setEntry).values(
            queue.map((s) => ({
              exerciseEntryId: entryId,
              order: setOrder++,
              weightKg: s.weight_kg,
              reps: s.reps,
              setType: s.set_type,
              isInferred: s.is_inferred,
            })),
          );
        }
        continue;
      }

      const [created] = await tx
        .insert(exerciseEntry)
        .values({
          sessionId: session.id,
          order: nextOrder++,
          rawName: patchExercise.raw_name,
          exerciseId: patchExercise.exercise_id ?? null,
          nameConfidence: 'high',
          regionFallback: patchExercise.region_fallback ?? null,
        })
        .returning({ id: exerciseEntry.id });
      if (!created) throw new Error('exercise_entry 插入没有返回 id');
      entryId = created.id;

      await tx.insert(setEntry).values(
        patchExercise.sets.map((s, i) => ({
          exerciseEntryId: entryId,
          order: i,
          weightKg: s.weight_kg,
          reps: s.reps,
          setType: s.set_type,
          isInferred: s.is_inferred,
        })),
      );
    }

    const allEntries = await tx
      .select({ id: exerciseEntry.id })
      .from(exerciseEntry)
      .where(eq(exerciseEntry.sessionId, session.id));
    const allSets = allEntries.length
      ? await tx
          .select({
            weightKg: setEntry.weightKg,
            reps: setEntry.reps,
          })
          .from(setEntry)
          .innerJoin(exerciseEntry, eq(setEntry.exerciseEntryId, exerciseEntry.id))
          .where(eq(exerciseEntry.sessionId, session.id))
      : [];

    const missing: MissingField[] = [];
    if (allEntries.length === 0) missing.push('exercises');
    if (allSets.some((s) => s.reps === null)) missing.push('reps');
    if (allSets.some((s) => s.weightKg === null)) missing.push('weight_kg');

    const note = session.notes === null && input.patch.note ? input.patch.note : session.notes;

    await tx
      .update(workoutSession)
      .set({
        notes: note,
        missingFields: missing,
        status: missing.length ? 'incomplete' : 'complete',
      })
      .where(eq(workoutSession.id, session.id));
  });

  return (await getSessionDetail({ user_id: input.user_id, session_id: input.session_id }))!;
}