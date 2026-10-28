import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { CorrectionCard, WorkoutCardExercise } from '../contracts/turn.js';
import { exerciseEntry, setEntry, workoutSession } from '../db/schema.js';
import { computeVolume, type VolumeSet } from '../metrics/volume.js';
import { exerciseNames } from './metrics.js';
import { getDb } from './pool.js';

/**
 * 窄修正：只改最近一次记录里某个动作的重量。
 * 句式必须带两个数值 + 更正线索；命中零个或多个动作都不猜。
 */

export interface WeightCorrection {
  old_kg: number;
  new_kg: number;
}

export type CorrectionResult =
  | { status: 'applied'; card: CorrectionCard }
  | { status: 'no_session' | 'no_match' | 'ambiguous'; reply: string };

const CUES = ['刚才', '刚刚', '上一条', '更正', '改一下', '说错了', '记错了'];
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`\s*(?:kg|KG|Kg|公斤|千克)?`;
const TO = String.raw`(?:是|应该是|改成|改为)`;

const PATTERNS: { re: RegExp; pick: 'new_old' | 'old_new' }[] = [
  // 刚才是 75kg 不是 70
  { re: new RegExp(String.raw`刚(?:才|刚)?\s*(?:是)?\s*${NUM}${UNIT}\s*不是\s*(?:了\s*)?${NUM}${UNIT}`, 'i'), pick: 'new_old' },
  // 70kg 说错了，是 75
  { re: new RegExp(`${NUM}${UNIT}\\s*(?:说错了|记错了)\\s*[，,、]?\\s*${TO}\\s*${NUM}${UNIT}`, 'i'), pick: 'old_new' },
  // 刚才不是 70kg，是 75
  { re: new RegExp(`(?:不是|原来不是)\\s*${NUM}${UNIT}\\s*[，,、]?\\s*${TO}\\s*${NUM}${UNIT}`, 'i'), pick: 'old_new' },
];

function toKg(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 解析「刚才是 X 不是 Y」类更正；不是这类句子返回 null。 */
export function parseWeightCorrection(message: string): WeightCorrection | null {
  if (!CUES.some((cue) => message.includes(cue))) return null;

  for (const { re, pick } of PATTERNS) {
    const m = message.match(re);
    if (!m) continue;
    const a = toKg(m[1]);
    const b = toKg(m[2]);
    if (!a || !b || a === b) continue;
    return pick === 'new_old' ? { old_kg: b, new_kg: a } : { old_kg: a, new_kg: b };
  }
  return null;
}

const WEIGHT_EPS = 0.001;

interface EntrySets {
  entryId: string;
  order: number;
  rawName: string;
  exerciseId: string | null;
  regionFallback: string | null;
  nameConfidence: 'high' | 'low' | null;
  isBodyweight: boolean;
  sets: {
    id: string;
    weightKg: number | null;
    reps: number | null;
    setType: 'warmup' | 'working';
    isInferred: boolean;
    bodyweightKg: number | null;
    tags: ('failure' | 'drop')[];
    drops: { weight_kg: number | null; reps: number | null }[] | null;
  }[];
}

async function loadSessionEntries(sessionId: string): Promise<EntrySets[]> {
  const db = getDb();
  const entries = await db
    .select()
    .from(exerciseEntry)
    .where(eq(exerciseEntry.sessionId, sessionId))
    .orderBy(asc(exerciseEntry.order));
  if (entries.length === 0) return [];

  const rows = await db
    .select()
    .from(setEntry)
    .where(inArray(setEntry.exerciseEntryId, entries.map((e) => e.id)))
    .orderBy(asc(setEntry.order));

  const byEntry = new Map<string, EntrySets['sets']>();
  for (const r of rows) {
    const bucket = byEntry.get(r.exerciseEntryId) ?? [];
    bucket.push({
      id: r.id,
      weightKg: r.weightKg,
      reps: r.reps,
      setType: r.setType === 'warmup' ? 'warmup' : 'working',
      isInferred: r.isInferred,
      bodyweightKg: r.bodyweightKg,
      tags: r.tags.filter((t): t is 'failure' | 'drop' => t === 'failure' || t === 'drop'),
      drops: r.drops,
    });
    byEntry.set(r.exerciseEntryId, bucket);
  }

  return entries.map((e) => ({
    entryId: e.id,
    order: e.order,
    rawName: e.rawName,
    exerciseId: e.exerciseId,
    regionFallback: e.regionFallback,
    nameConfidence:
      e.nameConfidence === 'high' || e.nameConfidence === 'low' ? e.nameConfidence : null,
    isBodyweight: e.isBodyweight,
    sets: byEntry.get(e.id) ?? [],
  }));
}

function asVolumeSets(entry: EntrySets): VolumeSet[] {
  return entry.sets.map((s) => ({
    weight_kg: s.weightKg,
    reps: s.reps,
    set_type: s.setType,
    is_inferred: s.isInferred,
    bodyweight_kg: s.bodyweightKg,
    tags: s.tags,
    drops: s.drops,
  }));
}

function toCardExercises(entries: EntrySets[], names: Map<string, string>): WorkoutCardExercise[] {
  return entries.map((e) => {
    const summary = computeVolume(asVolumeSets(e));
    return {
      raw_name: e.rawName,
      exercise_id: e.exerciseId,
      name_zh: e.exerciseId ? (names.get(e.exerciseId) ?? null) : null,
      region_fallback: e.regionFallback,
      name_confidence: e.nameConfidence ?? 'high',
      is_bodyweight: e.isBodyweight,
      sets: asVolumeSets(e),
      volume_kg: summary.total_kg,
      working_sets: summary.working_sets,
    };
  });
}

/** 把最近一次记录里重量 = old 的组改成 new；只有一个动作命中才动手。 */
export async function applyWeightCorrection(input: {
  user_id: string;
  old_kg: number;
  new_kg: number;
}): Promise<CorrectionResult> {
  const db = getDb();
  const sessions = await db
    .select({ id: workoutSession.id, date: workoutSession.date, splitLabel: workoutSession.splitLabel })
    .from(workoutSession)
    .where(eq(workoutSession.userId, input.user_id))
    .orderBy(desc(workoutSession.date), desc(workoutSession.createdAt))
    .limit(1);
  const session = sessions[0];
  if (!session) {
    return { status: 'no_session', reply: '还没有可以更正的训练记录，先把今天的训练记下来吧。' };
  }

  const entries = await loadSessionEntries(session.id);
  const matched = entries.filter((e) =>
    e.sets.some(
      (s) =>
        s.setType === 'working' &&
        s.weightKg !== null &&
        Math.abs(s.weightKg - input.old_kg) < WEIGHT_EPS,
    ),
  );

  if (matched.length === 0) {
    return {
      status: 'no_match',
      reply: `最近一次记录里没找到 ${input.old_kg}kg 的组，这次没动数据。若记在更早的记录里，可以用补全卡补一次。`,
    };
  }
  if (matched.length > 1) {
    return {
      status: 'ambiguous',
      reply: `最近一次记录里有 ${matched.length} 个动作都用过 ${input.old_kg}kg，分不清要改哪个，这次没动数据。`,
    };
  }

  const target = matched[0]!;
  const ids = target.sets
    .filter((s) => s.weightKg !== null && Math.abs(s.weightKg - input.old_kg) < WEIGHT_EPS)
    .map((s) => s.id);

  await db.transaction(async (tx) => {
    await tx.update(setEntry).set({ weightKg: input.new_kg }).where(inArray(setEntry.id, ids));
  });

  const updated = await loadSessionEntries(session.id);
  const names = exerciseNames();
  const exercises = toCardExercises(updated, names);
  const total = computeVolume(updated.flatMap(asVolumeSets));

  return {
    status: 'applied',
    card: {
      kind: 'correction',
      session_id: session.id,
      date: session.date,
      split_label: session.splitLabel,
      exercise_index: Math.max(
        0,
        updated.findIndex((e) => e.entryId === target.entryId),
      ),
      old_weight_kg: input.old_kg,
      new_weight_kg: input.new_kg,
      corrected_sets: ids.length,
      exercises,
      volume_kg: total.total_kg,
      working_sets: total.working_sets,
    },
  };
}