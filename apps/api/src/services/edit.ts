import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { EditRequest } from '../contracts/extraction.js';
import type { TurnCard } from '../contracts/turn.js';
import { exerciseEntry, setEntry, workoutSession } from '../db/schema.js';
import { resolveDate } from '../extraction/dates.js';
import { normalizeExerciseName } from '../extraction/normalize.js';
import { isBodyweightExercise } from '../metrics/bodyweight.js';
import { loadSessionEntries, type EntrySets } from './correction.js';
import { getDb } from './pool.js';
import { bodyweightOn } from './profile.js';

/**
 * 对话内修改已有训练 —— 模型只说「改哪条、改什么」，定位与写入全在这里做。
 * 命中零个或多个动作都不猜。
 */

interface CandidateSession {
  id: string;
  date: string;
  splitLabel: string | null;
}

type TargetResult =
  | { status: 'ok'; session: CandidateSession; entry: EntrySets | null }
  | { status: 'no_session' }
  | { status: 'no_match'; session: CandidateSession }
  | { status: 'ambiguous'; session: CandidateSession };

function chat(reply: string): TurnCard {
  return { kind: 'chat', reply };
}

function clean(value: string): string {
  return value.replace(/\s+/g, '');
}

/** 先按归一 id，再按原文包含；不做双向包含，免得「卧推」把「上斜卧推」也算上 */
function nameMatches(rawName: string, exerciseId: string | null, wanted: string): boolean {
  const norm = normalizeExerciseName(wanted);
  if (norm.exercise_id && exerciseId && norm.exercise_id === exerciseId) return true;
  const raw = clean(rawName);
  const want = clean(wanted);
  return want.length >= 2 && (raw === want || raw.includes(want));
}

async function findTarget(input: {
  user_id: string;
  day: string | null;
  exerciseName: string | null;
}): Promise<TargetResult> {
  const db = getDb();
  const sessions = await db
    .select({ id: workoutSession.id, date: workoutSession.date, splitLabel: workoutSession.splitLabel })
    .from(workoutSession)
    .where(
      input.day
        ? and(eq(workoutSession.userId, input.user_id), eq(workoutSession.date, input.day))
        : eq(workoutSession.userId, input.user_id),
    )
    .orderBy(desc(workoutSession.date), desc(workoutSession.createdAt))
    .limit(input.day ? 20 : 30);

  const first = sessions[0];
  if (!first) return { status: 'no_session' };
  if (!input.exerciseName) return { status: 'ok', session: first, entry: null };

  const entries = await db
    .select({
      sessionId: exerciseEntry.sessionId,
      rawName: exerciseEntry.rawName,
      exerciseId: exerciseEntry.exerciseId,
    })
    .from(exerciseEntry)
    .where(inArray(exerciseEntry.sessionId, sessions.map((s) => s.id)))
    .orderBy(asc(exerciseEntry.order));

  for (const session of sessions) {
    const hits = entries.filter(
      (e) => e.sessionId === session.id && nameMatches(e.rawName, e.exerciseId, input.exerciseName!),
    );
    if (hits.length > 1) return { status: 'ambiguous', session };
    if (hits.length === 1) {
      const loaded = await loadSessionEntries(session.id);
      const entry =
        loaded.find((e) => nameMatches(e.rawName, e.exerciseId, input.exerciseName!)) ?? null;
      return { status: 'ok', session, entry };
    }
  }

  return { status: 'no_match', session: first };
}

/** 对话里的一次修改；返回一张已改后的回执卡 */
export async function applyEdit(input: {
  user_id: string;
  request: EditRequest;
  now: Date;
}): Promise<TurnCard> {
  const { target, changes } = input.request;
  const day = target.day_hint ? resolveDate(target.day_hint, input.now) : null;
  const wantedName = target.exercise_name?.trim() || null;
  const changeName = changes.exercise_name?.trim() || null;
  const found = await findTarget({
    user_id: input.user_id,
    day,
    exerciseName: wantedName,
  });

  if (found.status === 'no_session') {
    return chat('还没有可以修改的训练记录，先记一次吧。');
  }
  if (found.status === 'no_match') {
    return chat(
      `没找到「${wantedName}」这个动作，这次没动数据。说清是哪天、哪个动作再试一次。`,
    );
  }
  if (found.status === 'ambiguous') {
    return chat(
      `有多个动作都包含「${wantedName}」，分不清要改哪个，这次没动数据。`,
    );
  }

  const session = found.session;
  const entry = found.entry;

  if (changes.weight_kg !== null && (!Number.isFinite(changes.weight_kg) || changes.weight_kg < 0)) {
    return chat('重量要填数字，这次没动数据。');
  }
  if (changes.reps !== null && (!Number.isInteger(changes.reps) || changes.reps <= 0)) {
    return chat('次数要填正整数，这次没动数据。');
  }

  const editsEntry = changeName !== null || changes.weight_kg !== null || changes.reps !== null;
  if (editsEntry && !entry) {
    return chat('要改哪个动作？可以说「把今天的卧推重量改成 80kg」。');
  }

  const newDate = changes.day_hint ? resolveDate(changes.day_hint, input.now) : null;
  const parts: string[] = [];
  const db = getDb();

  await db.transaction(async (tx) => {
    if (newDate && newDate !== session.date) {
      await tx
        .update(workoutSession)
        .set({ date: newDate })
        .where(eq(workoutSession.id, session.id));
      parts.push(`日期改到 ${newDate}`);
    }

    if (!entry) return;

    if (changeName !== null) {
      const norm = normalizeExerciseName(changeName);
      const isBodyweight = isBodyweightExercise(norm.exercise_id);
      await tx
        .update(exerciseEntry)
        .set({
          rawName: changeName,
          exerciseId: norm.exercise_id,
          nameConfidence: norm.level === 1 ? 'high' : 'low',
          regionFallback: norm.region_fallback,
          isBodyweight,
        })
        .where(eq(exerciseEntry.id, entry.entryId));

      if (isBodyweight !== entry.isBodyweight) {
        const bodyweightKg = isBodyweight
          ? await bodyweightOn(input.user_id, newDate ?? session.date)
          : null;
        await tx
          .update(setEntry)
          .set({ bodyweightKg })
          .where(eq(setEntry.exerciseEntryId, entry.entryId));
      }
      parts.push(`「${entry.rawName}」改成「${changeName}」`);
    }

    if (changes.weight_kg !== null || changes.reps !== null) {
      const working = entry.sets.filter((s) => s.setType === 'working');
      const picked = working.length > 0 ? working : entry.sets;
      if (picked.length > 0) {
        await tx
          .update(setEntry)
          .set({
            ...(changes.weight_kg !== null ? { weightKg: changes.weight_kg } : {}),
            ...(changes.reps !== null ? { reps: changes.reps } : {}),
            isInferred: false,
          })
          .where(
            inArray(
              setEntry.id,
              picked.map((s) => s.id),
            ),
          );
        if (changes.weight_kg !== null) parts.push(`重量改成 ${changes.weight_kg}kg`);
        if (changes.reps !== null) parts.push(`次数改成 ${changes.reps}`);
      }
    }
  });

  if (parts.length === 0) {
    return chat('这次没有改动 —— 要改的数值和原来一样。');
  }
  return chat(`已修改 ${newDate ?? session.date} 的训练：${parts.join('；')}。`);
}