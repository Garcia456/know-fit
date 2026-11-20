import { and, asc, desc, eq, gte, isNull, lt, lte, or } from 'drizzle-orm';
import { bodyMetric, exerciseEntry, setEntry, workoutSession } from '../db/schema.js';
import type {
  SessionVolume,
  StatsRange,
  VolumeHook,
  WeeklyVolume,
  WeightHistory,
} from '../contracts/metrics.js';
import { toLocalDate } from '../extraction/dates.js';
import type { HookInput } from '../graph/deps.js';
import { loadSeed, type Seed } from '../seed/load.js';
import { buildVolumeHook } from '../metrics/hook.js';
import { allocateMuscleVolume, type AllocExercise } from '../metrics/regions.js';
import { countWorkingSets, summarizeHardSets } from '../metrics/hardSets.js';
import {
  MUSCLE_GROUPS,
  REGION_FALLBACK_LABELS,
} from '../metrics/muscleGroups.js';
import { computeVolume, type VolumeSet } from '../metrics/volume.js';
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

/** 20 块肌群及 coarse 归类 —— 检索 query 聚部位用 */
export function muscleRegions() {
  return seed().muscle_regions;
}

function asTags(values: string[]): ('failure' | 'drop' | 'rest_pause')[] {
  return values.filter(
    (v): v is 'failure' | 'drop' | 'rest_pause' =>
      v === 'failure' || v === 'drop' || v === 'rest_pause',
  );
}

/** 动作 id → 中文名；读历史时补展示名，不改落库值。 */
export function exerciseNames(): Map<string, string> {
  return new Map(seed().exercises.map((e) => [e.id, e.name_zh]));
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
      bodyweightKg: setEntry.bodyweightKg,
      tags: setEntry.tags,
      drops: setEntry.drops,
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
      bodyweight_kg: r.bodyweightKg,
      tags: asTags(r.tags),
      drops: r.drops,
    });
    byEntry.set(r.exerciseEntryId, bucket);
  }

  return entries.map((e) => ({
    exercise_id: e.exerciseId,
    region_fallback: e.regionFallback,
    sets: byEntry.get(e.id) ?? [],
  }));
}

/** 一次训练的容量与肌群分摊 —— 读不到这条（或不属于该用户）时返回 null */
export async function sessionVolume(input: {
  user_id: string;
  session_id: string;
}): Promise<SessionVolume | null> {
  const db = getDb();
  const { user_id, session_id: sessionId } = input;
  const found = await db
    .select({ id: workoutSession.id })
    .from(workoutSession)
    .where(and(eq(workoutSession.id, sessionId), eq(workoutSession.userId, user_id)))
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
    .where(and(eq(workoutSession.id, exclude_session_id), eq(workoutSession.userId, user_id)))
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

  const v = await sessionVolume({ user_id, session_id: prev.id });
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

const round2 = (n: number) => Math.round(n * 100) / 100;

function addDays(d: Date, days: number): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() + days);
  return c;
}

/** 所在周的周一（本地时区，周一为一周起点） */
function mondayOf(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return c;
}

function weekStartOf(dateKey: string): string {
  return toLocalDate(mondayOf(new Date(`${dateKey}T00:00:00`)));
}

/** 日期键平移 —— 交给 Date 处理跨月 / 跨年与夏令时 */
function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** 闭区间天数，含首尾 */
function spanDays(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function clampWeeks(n: number): number {
  return Math.min(Math.max(Math.trunc(n), 1), 26);
}

/** 近 N 个自然周的容量 —— 正式组 Σ 重量 × 次数，与单次容量同一算法。 */
export async function weeklyVolume(input: {
  user_id: string;
  weeks: number;
  now?: Date;
}): Promise<WeeklyVolume> {
  const weeks = clampWeeks(input.weeks);
  const firstMonday = addDays(mondayOf(input.now ?? new Date()), -7 * (weeks - 1));
  const from = toLocalDate(firstMonday);

  const rows = await getDb()
    .select({
      date: workoutSession.date,
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
    .innerJoin(workoutSession, eq(exerciseEntry.sessionId, workoutSession.id))
    .where(and(eq(workoutSession.userId, input.user_id), gte(workoutSession.date, from)));

  const byWeek = new Map<string, VolumeSet[]>();
  for (const r of rows) {
    const key = weekStartOf(r.date);
    const bucket = byWeek.get(key) ?? [];
    bucket.push({
      weight_kg: r.weightKg,
      reps: r.reps,
      set_type: r.setType === 'warmup' ? 'warmup' : 'working',
      is_inferred: r.isInferred,
      bodyweight_kg: r.bodyweightKg,
      tags: asTags(r.tags),
      drops: r.drops,
    });
    byWeek.set(key, bucket);
  }

  const points = Array.from({ length: weeks }, (_, i) => {
    const weekStart = toLocalDate(addDays(firstMonday, i * 7));
    const sets = byWeek.get(weekStart) ?? [];
    const summary = computeVolume(sets);
    return {
      week_start: weekStart,
      total_volume_kg: summary.total_kg,
      working_sets: summary.working_sets,
      hard_sets: countWorkingSets(sets),
    };
  });

  const thisWeek = points.at(-1)!;
  const lastKg = points.at(-2)?.total_volume_kg ?? 0;

  return {
    weeks: points,
    this_week_kg: thisWeek.total_volume_kg,
    last_week_kg: lastKg,
    delta_pct: lastKg === 0 ? null : round2(((thisWeek.total_volume_kg - lastKg) / lastKg) * 100),
  };
}

/** 近 N 周体重历史 —— 只取有记录的日子，不插值、不拿最近值补空。 */
export async function weightHistory(input: {
  user_id: string;
  weeks: number;
  now?: Date;
}): Promise<WeightHistory> {
  const weeks = clampWeeks(input.weeks);
  const from = toLocalDate(addDays(mondayOf(input.now ?? new Date()), -7 * (weeks - 1)));

  const rows = await getDb()
    .select({ date: bodyMetric.date, weightKg: bodyMetric.weightKg })
    .from(bodyMetric)
    .where(and(eq(bodyMetric.userId, input.user_id), gte(bodyMetric.date, from)))
    .orderBy(asc(bodyMetric.date));

  const points = rows.map((r) => ({ date: r.date, weight_kg: r.weightKg }));
  const latest = points.at(-1) ?? null;
  const first = points[0];

  return {
    points,
    latest,
    delta_kg: points.length >= 2 && latest && first ? round2(latest.weight_kg - first.weight_kg) : null,
  };
}

/** 任意日期范围的容量 / 肌群 / 体重 —— 统计页一次取全 */
export async function statsRange(input: {
  user_id: string;
  from: string;
  to: string;
}): Promise<StatsRange> {
  const db = getDb();
  const { user_id, from, to } = input;

  // 上一区间：紧邻 from 之前、与当前区间等长的一段（ADR-071）
  const span = spanDays(from, to);
  const prevTo = shiftDateKey(from, -1);
  const prevFrom = shiftDateKey(prevTo, -(span - 1));

  // 两段并进同一条查询，按日期分桶；不增加往返次数
  const rows = await db
    .select({
      sessionDate: workoutSession.date,
      entryId: exerciseEntry.id,
      exerciseId: exerciseEntry.exerciseId,
      regionFallback: exerciseEntry.regionFallback,
      rawName: exerciseEntry.rawName,
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
    .innerJoin(workoutSession, eq(exerciseEntry.sessionId, workoutSession.id))
    .where(
      and(
        eq(workoutSession.userId, user_id),
        gte(workoutSession.date, prevFrom),
        lte(workoutSession.date, to),
      ),
    );

  type StatsEntry = AllocExercise & { date: string; raw_name: string };
  const entries = new Map<string, StatsEntry>();
  let previousHardSets = 0;

  for (const r of rows) {
    if (r.sessionDate < from) {
      if (r.setType !== 'warmup') previousHardSets += 1;
      continue;
    }
    const entry = entries.get(r.entryId) ?? {
      date: r.sessionDate,
      exercise_id: r.exerciseId,
      region_fallback: r.regionFallback,
      raw_name: r.rawName,
      sets: [],
    };
    entry.sets.push({
      weight_kg: r.weightKg,
      reps: r.reps,
      set_type: r.setType === 'warmup' ? 'warmup' : 'working',
      is_inferred: r.isInferred,
      bodyweight_kg: r.bodyweightKg,
      tags: asTags(r.tags),
      drops: r.drops,
    });
    entries.set(r.entryId, entry);
  }

  const byDate = new Map<string, { total: number; sets: number; hard: number }>();
  for (const entry of entries.values()) {
    const summary = computeVolume(entry.sets);
    const bucket = byDate.get(entry.date) ?? { total: 0, sets: 0, hard: 0 };
    bucket.total += summary.total_kg;
    bucket.sets += summary.working_sets;
    bucket.hard += countWorkingSets(entry.sets);
    byDate.set(entry.date, bucket);
  }

  const days = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      total_volume_kg: round2(v.total),
      working_sets: v.sets,
      hard_sets: v.hard,
    }));

  const muscles = Array.from(entries.values());
  const muscle = allocateMuscleVolume(muscles, seed());
  const hard = summarizeHardSets(muscles, seed());
  const regionNames = new Map(seed().muscle_regions.map((r) => [r.id, r.name_zh]));

  const muscleGroups = MUSCLE_GROUPS.map((group) => ({
    id: group.id,
    name_zh: group.name_zh,
    weekly_low: group.weekly_low,
    weekly_high: group.weekly_high,
    hard_sets: hard.by_group[group.id] ?? 0,
    muscles: group.members.map((id) => ({
      id,
      name_zh: regionNames.get(id) ?? id,
      hard_sets: hard.by_muscle[id] ?? 0,
      sources: hard.by_muscle_sources[id] ?? [],
    })),
  }));

  const weightRows = await db
    .select({ date: bodyMetric.date, weightKg: bodyMetric.weightKg })
    .from(bodyMetric)
    .where(
      and(
        eq(bodyMetric.userId, user_id),
        gte(bodyMetric.date, from),
        lte(bodyMetric.date, to),
      ),
    )
    .orderBy(asc(bodyMetric.date));
  const weightPoints = weightRows.map((r) => ({ date: r.date, weight_kg: r.weightKg }));
  const weightLatest = weightPoints.at(-1) ?? null;
  const weightFirst = weightPoints[0];

  const delta = hard.total - previousHardSets;

  return {
    from,
    to,
    days,
    total_volume_kg: round2(days.reduce((sum, d) => sum + d.total_volume_kg, 0)),
    working_sets: days.reduce((sum, d) => sum + d.working_sets, 0),
    hard_sets: hard.total,
    by_muscle_sets: hard.by_muscle,
    by_group_sets: hard.by_group,
    muscle_groups: muscleGroups,
    unclassified: {
      ...hard.unclassified,
      region_labels: REGION_FALLBACK_LABELS,
    },
    previous: {
      from: prevFrom,
      to: prevTo,
      hard_sets: previousHardSets,
      delta,
      delta_pct: previousHardSets === 0 ? null : round2((delta / previousHardSets) * 100),
    },
    inferred_hard_sets: hard.inferred_hard_sets,
    warmup_sets: hard.warmup_sets,
    training_days: days.length,
    by_muscle: muscle.by_muscle,
    weight_points: weightPoints,
    weight_latest: weightLatest,
    weight_delta_kg:
      weightPoints.length >= 2 && weightLatest && weightFirst
        ? round2(weightLatest.weight_kg - weightFirst.weight_kg)
        : null,
  };
}