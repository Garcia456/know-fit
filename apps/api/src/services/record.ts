import { eq } from 'drizzle-orm';
import { conversationTurn, exerciseEntry, setEntry, userProfile, workoutSession } from '../db/schema.js';
import type { Intent } from '../contracts/extraction.js';
import type { PersistWorkoutInput } from '../graph/deps.js';
import type { TrainingBand } from '../graph/state.js';
import { getDb } from './pool.js';

/**
 * 训练侧的读写 —— 🔴 本文件在服务层，只有它能 import `db/schema`（ADR-008 护栏 R-A）。
 */

export interface LogTurnInput {
  user_id: string;
  message: string;
  intent: Intent;
  linked_record_id: string | null;
}

/** 写一条用户侧轮次；它的 id 就是这一轮的 `turn_id` */
export async function logTurn(input: LogTurnInput): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(conversationTurn)
    .values({
      userId: input.user_id,
      role: 'user',
      content: input.message,
      intent: input.intent,
      linkedRecordId: input.linked_record_id,
    })
    .returning({ id: conversationTurn.id });

  if (!row) throw new Error('conversation_turn 插入没有返回 id');
  return row.id;
}

/** 边界判定要用的训练年限档 —— 读不到就按「练了 3 个月以上」算（少拦比多拦轻） */
export async function loadTrainingBand(userId: string): Promise<TrainingBand> {
  const db = getDb();
  const rows = await db
    .select({ band: userProfile.trainingYearsBand })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  const band = rows[0]?.band;
  return band === 'lt_3m' || band === 'gt_2y' ? band : '3m_2y';
}

/** 一次训练整套落库 —— 三步一个事务，因为半条记录比没记录更难收拾 */
export async function persistWorkout(input: PersistWorkoutInput): Promise<{ session_id: string }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(workoutSession)
      .values({
        userId: input.user_id,
        date: input.date,
        splitLabel: input.split_label,
        status: input.status,
        missingFields: input.missing_fields,
        notes: input.notes,
      })
      .returning({ id: workoutSession.id });

    if (!session) throw new Error('workout_session 插入没有返回 id');

    for (const ex of input.exercises) {
      const [entry] = await tx
        .insert(exerciseEntry)
        .values({
          sessionId: session.id,
          order: ex.order,
          rawName: ex.raw_name,
          exerciseId: ex.exercise_id,
          nameConfidence: ex.name_confidence,
          regionFallback: ex.region_fallback,
        })
        .returning({ id: exerciseEntry.id });

      if (!entry) throw new Error(`exercise_entry 插入没有返回 id（order ${ex.order}）`);

      if (ex.sets.length === 0) continue;

      await tx.insert(setEntry).values(
        ex.sets.map((s) => ({
          exerciseEntryId: entry.id,
          order: s.order,
          weightKg: s.weight_kg,
          reps: s.reps,
          setType: s.set_type,
          isInferred: s.is_inferred,
        })),
      );
    }

    return { session_id: session.id };
  });
}