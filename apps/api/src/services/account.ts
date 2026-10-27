import { eq } from 'drizzle-orm';
import {
  assessment,
  conversationTurn,
  recoveryNudge,
  workoutSession,
} from '../db/schema.js';
import { getDb } from './pool.js';

/**
 * 「清空训练记录」—— 只删训练相关，保留档案与体重历史（ADR-049）。
 * 必须在一个事务里删干净：assessment.related_record_id 是 SET NULL，
 * 只删 workout_session 会留下指向已删记录的旧评估。
 */
export async function clearTrainingRecords(userId: string): Promise<{
  sessions: number;
  assessments: number;
  turns: number;
  nudges: number;
}> {
  return getDb().transaction(async (tx) => {
    const turns = await tx
      .delete(conversationTurn)
      .where(eq(conversationTurn.userId, userId))
      .returning({ id: conversationTurn.id });
    const nudges = await tx
      .delete(recoveryNudge)
      .where(eq(recoveryNudge.userId, userId))
      .returning({ id: recoveryNudge.id });
    // citation 随 assessment 级联删除
    const assessments = await tx
      .delete(assessment)
      .where(eq(assessment.userId, userId))
      .returning({ id: assessment.id });
    // exercise_entry / set_entry 随 workout_session 级联删除
    const sessions = await tx
      .delete(workoutSession)
      .where(eq(workoutSession.userId, userId))
      .returning({ id: workoutSession.id });

    return {
      sessions: sessions.length,
      assessments: assessments.length,
      turns: turns.length,
      nudges: nudges.length,
    };
  });
}