import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type {
  HistoryItem,
  PatchSessionRequest,
  SessionDetail,
  SessionExercise,
  SessionListItem,
  UpdateSessionRequest,
} from '../contracts/sessions.js';
import type { MissingField } from '../contracts/extraction.js';
import { assessment, exerciseEntry, setEntry, workoutSession } from '../db/schema.js';
import { normalizeExerciseName } from '../extraction/normalize.js';
import { getDb } from './pool.js';
import { buildVolumeHook } from '../metrics/hook.js';
import { computeVolume, type VolumeSet } from '../metrics/volume.js';
import { isBodyweightExercise } from '../metrics/bodyweight.js';
import { exerciseNames, prevSameSplitVolume, sessionVolume } from './metrics.js';
import { bodyweightOn } from './profile.js';

/** 日历与某天详情 —— 容量不落库，读时现算。 */

function asMissingFields(values: string[]): MissingField[] {
  return values.filter(
    (f): f is MissingField => f === 'exercises' || f === 'reps' || f === 'weight_kg',
  );
}

function asTags(values: string[]): ('failure' | 'drop' | 'rest_pause')[] {
  return values.filter(
    (v): v is 'failure' | 'drop' | 'rest_pause' =>
      v === 'failure' || v === 'drop' || v === 'rest_pause',
  );
}

function asDrops(
  value: { weight_kg: number | null; reps: number | null }[] | null,
): { weight_kg: number | null; reps: number | null }[] | null {
  return value ?? null;
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
          bodyweightKg: setEntry.bodyweightKg,
          tags: setEntry.tags,
          drops: setEntry.drops,
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
      bodyweight_kg: row.bodyweightKg,
      tags: asTags(row.tags),
      drops: asDrops(row.drops),
    });
    setsBySession.set(sessionId, bucket);
  }

  const entriesBySession = new Map<string, typeof entries>();
  for (const entry of entries) {
    const bucket = entriesBySession.get(entry.sessionId) ?? [];
    bucket.push(entry);
    entriesBySession.set(entry.sessionId, bucket);
  }

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
      // 展示按用户原话；归一后的中文名只用于肌群归类
      exercise_names: sessionEntries.map((e) => e.rawName),
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
      bodyweight_kg: row.set_entry.bodyweightKg,
      tags: asTags(row.set_entry.tags),
      drops: asDrops(row.set_entry.drops),
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
      is_bodyweight: entry.isBodyweight,
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
    const bodyweightKg = await bodyweightOn(input.user_id, session.date);

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
              bodyweightKg: match.isBodyweight ? bodyweightKg : null,
              tags: [],
              drops: null,
            })),
          );
        }
        continue;
      }

      const isBodyweight = isBodyweightExercise(patchExercise.exercise_id ?? null);
      const [created] = await tx
        .insert(exerciseEntry)
        .values({
          sessionId: session.id,
          order: nextOrder++,
          rawName: patchExercise.raw_name,
          exerciseId: patchExercise.exercise_id ?? null,
          nameConfidence: 'high',
          regionFallback: patchExercise.region_fallback ?? null,
          isBodyweight,
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
          bodyweightKg: isBodyweight ? bodyweightKg : null,
          tags: [],
          drops: null,
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
            isBodyweight: exerciseEntry.isBodyweight,
          })
          .from(setEntry)
          .innerJoin(exerciseEntry, eq(setEntry.exerciseEntryId, exerciseEntry.id))
          .where(eq(exerciseEntry.sessionId, session.id))
      : [];

    const missing: MissingField[] = [];
    if (allEntries.length === 0) missing.push('exercises');
    if (allSets.some((s) => s.reps === null)) missing.push('reps');
    if (allSets.some((s) => !s.isBodyweight && s.weightKg === null)) missing.push('weight_kg');

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

/**
 * 手动编辑：按提交的数组整份重建。
 * 动作按 raw_name 对齐已有行（对得上的复用，对不上的新建，没提交的删除）；
 * 动作改名 = 用户认领，该动作的组不再算推测。
 * 不新增动作入口 —— 新增仍走对话录入（ADR-065）。
 */
export async function updateSession(input: {
  user_id: string;
  session_id: string;
  patch: UpdateSessionRequest;
}): Promise<SessionDetail | 'not_found'> {
  const db = getDb();
  const found = await db
    .select()
    .from(workoutSession)
    .where(and(eq(workoutSession.id, input.session_id), eq(workoutSession.userId, input.user_id)))
    .limit(1);
  const session = found[0];
  if (!session) return 'not_found';

  await db.transaction(async (tx) => {
    const entries = await tx
      .select()
      .from(exerciseEntry)
      .where(eq(exerciseEntry.sessionId, session.id))
      .orderBy(asc(exerciseEntry.order));

    const entriesBySet = new Map<string, typeof setEntry.$inferSelect[]>();
    if (entries.length > 0) {
      const rows = await tx
        .select()
        .from(setEntry)
        .where(
          inArray(
            setEntry.exerciseEntryId,
            entries.map((e) => e.id),
          ),
        )
        .orderBy(asc(setEntry.order));
      for (const row of rows) {
        const bucket = entriesBySet.get(row.exerciseEntryId) ?? [];
        bucket.push(row);
        entriesBySet.set(row.exerciseEntryId, bucket);
      }
    }

    const bodyweightKg = await bodyweightOn(input.user_id, session.date);
    const usedIds = new Set<string>();

    for (const [i, patchExercise] of input.patch.exercises.entries()) {
      const norm = normalizeExerciseName(patchExercise.raw_name);
      const isBodyweight = isBodyweightExercise(norm.exercise_id);

      // 同名且没用过的行 = 同一个动作；改名后的不再匹配，按新行动重建
      const match = entries.find((e) => e.rawName === patchExercise.raw_name && !usedIds.has(e.id));

      if (!match) {
        const [created] = await tx
          .insert(exerciseEntry)
          .values({
            sessionId: session.id,
            order: i,
            rawName: patchExercise.raw_name,
            exerciseId: norm.exercise_id,
            nameConfidence: norm.level === 1 ? 'high' : 'low',
            regionFallback: norm.region_fallback,
            isBodyweight,
          })
          .returning({ id: exerciseEntry.id });
        if (!created) throw new Error('exercise_entry 插入没有返回 id');

        await tx.insert(setEntry).values(
          patchExercise.sets.map((s, j) => ({
            exerciseEntryId: created.id,
            order: j,
            weightKg: s.weight_kg,
            reps: s.reps,
            setType: 'working' as const,
            isInferred: false,
            bodyweightKg: isBodyweight ? bodyweightKg : null,
            tags: s.tags ?? [],
            drops: s.drops ?? null,
          })),
        );
        continue;
      }

      usedIds.add(match.id);
      await tx
        .update(exerciseEntry)
        .set({
          order: i,
          rawName: patchExercise.raw_name,
          exerciseId: norm.exercise_id,
          nameConfidence: norm.level === 1 ? 'high' : 'low',
          regionFallback: norm.region_fallback,
          isBodyweight,
        })
        .where(eq(exerciseEntry.id, match.id));

      if (isBodyweight !== match.isBodyweight) {
        await tx
          .update(setEntry)
          .set({ bodyweightKg: isBodyweight ? bodyweightKg : null })
          .where(eq(setEntry.exerciseEntryId, match.id));
      }

      const existingSets = entriesBySet.get(match.id) ?? [];
      const kept = Math.min(existingSets.length, patchExercise.sets.length);

      for (let j = 0; j < kept; j += 1) {
        const set = existingSets[j]!;
        const patchSet = patchExercise.sets[j]!;
        const setType = patchSet.set_type ?? (set.setType === 'warmup' ? 'warmup' : 'working');
        // 手动改过的组不再算推测 —— 没动的组保留原标记
        const changed =
          patchSet.weight_kg !== set.weightKg ||
          patchSet.reps !== set.reps ||
          setType !== set.setType ||
          (patchSet.tags !== undefined &&
            JSON.stringify(patchSet.tags) !== JSON.stringify(set.tags)) ||
          (patchSet.drops !== undefined &&
            JSON.stringify(patchSet.drops) !== JSON.stringify(set.drops));
        await tx
          .update(setEntry)
          .set({
            order: j,
            weightKg: patchSet.weight_kg,
            reps: patchSet.reps,
            setType,
            ...(patchSet.tags !== undefined ? { tags: patchSet.tags } : {}),
            ...(patchSet.drops !== undefined ? { drops: patchSet.drops } : {}),
            ...(changed ? { isInferred: false } : {}),
          })
          .where(eq(setEntry.id, set.id));
      }

      // 多出来的组删掉；用户新复制的组追加在末尾
      if (existingSets.length > kept) {
        await tx.delete(setEntry).where(
          inArray(
            setEntry.id,
            existingSets.slice(kept).map((s) => s.id),
          ),
        );
      }
      if (patchExercise.sets.length > kept) {
        await tx.insert(setEntry).values(
          patchExercise.sets.slice(kept).map((s, k) => ({
            exerciseEntryId: match.id,
            order: kept + k,
            weightKg: s.weight_kg,
            reps: s.reps,
            setType: s.set_type ?? 'working',
            isInferred: false,
            bodyweightKg: isBodyweight ? bodyweightKg : null,
            tags: s.tags ?? [],
            drops: s.drops ?? null,
          })),
        );
      }
    }

    const removed = entries.filter((e) => !usedIds.has(e.id)).map((e) => e.id);
    if (removed.length > 0) {
      await tx.delete(exerciseEntry).where(inArray(exerciseEntry.id, removed));
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
            tags: setEntry.tags,
            drops: setEntry.drops,
            isBodyweight: exerciseEntry.isBodyweight,
          })
          .from(setEntry)
          .innerJoin(exerciseEntry, eq(setEntry.exerciseEntryId, exerciseEntry.id))
          .where(eq(exerciseEntry.sessionId, session.id))
      : [];

    const missing: MissingField[] = [];
    if (allEntries.length === 0) missing.push('exercises');
    if (
      allSets.some(
        (s) =>
          s.reps === null ||
          (Array.isArray(s.drops) &&
            (s.drops as { reps: number | null }[]).some((d) => d.reps === null)),
      )
    ) {
      missing.push('reps');
    }
    if (
      allSets.some((s) => {
        if (s.isBodyweight || s.weightKg !== null) return false;
        return !(
          Array.isArray(s.drops) &&
          (s.drops as { weight_kg: number | null }[]).some((d) => d.weight_kg !== null)
        );
      })
    ) {
      missing.push('weight_kg');
    }

    await tx
      .update(workoutSession)
      .set({
        notes: input.patch.note === undefined ? session.notes : input.patch.note,
        missingFields: missing,
        status: missing.length ? 'incomplete' : 'complete',
      })
      .where(eq(workoutSession.id, session.id));
  });

  return (await getSessionDetail({ user_id: input.user_id, session_id: input.session_id }))!;
}

/** 删一条训练：动作 / 组 / 评估 / 提示级联清掉；对话消息保留但不再指向它。 */
export async function deleteSession(input: {
  user_id: string;
  session_id: string;
}): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: workoutSession.id })
      .from(workoutSession)
      .where(
        and(eq(workoutSession.id, input.session_id), eq(workoutSession.userId, input.user_id)),
      )
      .limit(1);
    if (!rows[0]) return false;

    await tx.delete(assessment).where(eq(assessment.relatedRecordId, input.session_id));
    await tx.delete(workoutSession).where(eq(workoutSession.id, input.session_id));
    return true;
  });
}