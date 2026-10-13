import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { exerciseEntry, setEntry, workoutSession } from '../db/schema.js';
import type { SessionVolume, VolumeHook } from '../contracts/metrics.js';
import type { HookInput } from '../graph/deps.js';
import { loadSeed, type Seed } from '../seed/load.js';
import { buildVolumeHook } from '../metrics/hook.js';
import { allocateMuscleVolume, type AllocExercise } from '../metrics/regions.js';
import { computeVolume } from '../metrics/volume.js';
import { getDb } from './pool.js';

/**
 * 训练量的读与算。
 * 容量不落库 —— 每次查询现算（源数据是组，落库会产生双份真相）。
 */

let cachedSeed: Seed | null = null;
function seed(): Seed {
  cachedSeed ??= loadSeed();
  return cachedSeed;
}

async function loadExercises(sessionId: string): Promise<AllocExercise[]> {
  const db = getDb();

  const entries = await db
    .select({
      id: exerciseEntry.id,
      exerciseId: exerciseEntry.exerciseId,
      regionFallback: exerciseEntry.regionFallback,
    })
    .from(exerciseEntry)
    .where(eq(exerciseEntry.sessionId, sessionId))
    .orderBy(exerciseEntry.order);

  if (entries.length === 0) return [];

  const rows = await db
    .select({
      exerciseEntryId: setEntry.exerciseEntryId,
      weightKg: setEntry.weightKg,
      reps: setEntry.reps,
      setType: setEntry.setType,
      isInferred: setEntry.isInferred,
    })
    .from(setEntry)
    .innerJoin(exerciseEntry, eq(setEntry.exerciseEntryId, exerciseEntry.id))
    .where(eq(exerciseEntry.sessionId, sessionId))
    .orderBy(setEntry.order);

  const byEntry = new Map<string, AllocExercise['sets']>();
  for (const r of rows) {
    const bucket = byEntry.get(r.exerciseEntryId) ?? [];
    bucket.push({
      weight_kg: r.weightKg,
      reps: r.reps,
      set_type: r.setType === 'warmup' ? 'warmup' : 'working',
      is_inferred: r.isInferred,
    });
    byEntry.set(r.exerciseEntryId, bucket);
  }

  return entries.map((e) => ({
    exercise_id: e.exerciseId,
    region_fallback: e.regionFallback,
    sets: byEntry.get(e.id) ?? [],
  }));
}

/** 一次训练的容量与肌群分摊 —— 读不到这条记录时返回 null */
export async function sessionVolume(sessionId: string): Promise<SessionVolume | null> {
  const db = getDb();
  const found = await db
    .select({ id: workoutSession.id })
    .from(workoutSession)
    .where(eq(workoutSession.id, sessionId))
    .limit(1);
  if (!found[0]) return null;

  const exercises = await loadExercises(sessionId);
  const summary = computeVolume(exercises.flatMap((e) => e.sets));
  const muscle = allocateMuscleVolume(exercises, seed());

  return {
    session_id: sessionId,
    total_volume_kg: summary.total_kg,
    working_sets: summary.working_sets,
    warmup_sets: summary.warmup_sets,
    skipped_sets: summary.skipped_sets,
    inferred_sets: summary.inferred_sets,
    by_muscle: muscle.by_muscle,
    unrecognized_exercises: muscle.unrecognized_exercises,
  };
}

/** 同一个 split 的上一次训练的容量 —— 没有更早的同 split 记录时返回 null */
export async function prevSameSplitVolume(input: {
  user_id: string;
  split_label: string | null;
  exclude_session_id: string;
}): Promise<number | null> {
  const db = getDb();
  const { user_id, split_label, exclude_session_id } = input;

  // 「上一次」= 排在本条之前的那条（先比日期，同一天再比落库先后）
  const current = await db
    .select({ date: workoutSession.date, createdAt: workoutSession.createdAt })
    .from(workoutSession)
    .where(eq(workoutSession.id, exclude_session_id))
    .limit(1);
  const cur = current[0];
  if (!cur) return null;

  const splitMatch =
    split_label === null ? isNull(workoutSession.splitLabel) : eq(workoutSession.splitLabel, split_label);

  const rows = await db
    .select({ id: workoutSession.id })
    .from(workoutSession)
    .where(
      and(
        eq(workoutSession.userId, user_id),
        splitMatch,
        or(
          lt(workoutSession.date, cur.date),
          and(eq(workoutSession.date, cur.date), lt(workoutSession.createdAt, cur.createdAt)),
        ),
      ),
    )
    .orderBy(desc(workoutSession.date), desc(workoutSession.createdAt))
    .limit(1);

  const prev = rows[0];
  if (!prev) return null;

  const v = await sessionVolume(prev.id);
  return v?.total_volume_kg ?? null;
}

/** 记录完成后给卡片配的钩子 —— 本次容量（现算）+ 同 split 上一次的容量（读库） */
export async function volumeHookFor(input: HookInput): Promise<VolumeHook> {
  const current = computeVolume(input.exercises.flatMap((e) => e.sets)).total_kg;
  const baseline = await prevSameSplitVolume({
    user_id: input.user_id,
    split_label: input.split_label,
    exclude_session_id: input.session_id,
  });
  return buildVolumeHook({ current, baseline, split_label: input.split_label });
}