import type { QueryRequest } from '../contracts/extraction.js';
import type { SessionDetail, SessionExercise } from '../contracts/sessions.js';
import type { TurnCard } from '../contracts/turn.js';
import { tryResolveDate } from '../extraction/dates.js';
import { getSessionDetail, listHistory, listSessions } from './history.js';

/**
 * 对话内查记录 —— 只读，不改数据。
 * 「今天」「10月31号」由代码解析；没提日期就看最近一次。
 */

function chat(reply: string): TurnCard {
  return { kind: 'chat', reply };
}

function formatSet(set: SessionExercise['sets'][number]): string {
  const weight =
    set.weight_kg !== null
      ? `${set.weight_kg}kg`
      : set.bodyweight_kg != null
        ? '自重'
        : '重量未填';
  const main = `${weight}×${set.reps ?? '?'}`;
  const drops = (set.drops ?? [])
    .map((d) => `+${d.weight_kg ?? set.weight_kg ?? '自重'}kg×${d.reps ?? '?'}`)
    .join('');
  return `${set.set_type === 'warmup' ? '热身 ' : ''}${main}${drops}`;
}

function formatExercise(exercise: SessionExercise): string {
  const working = exercise.sets.filter((s) => s.set_type === 'working');
  const warmup = exercise.sets.filter((s) => s.set_type === 'warmup');
  const parts = [
    ...(warmup.length ? [`热身 ${warmup.map(formatSet).join('、')}`] : []),
    ...(working.length ? [working.map(formatSet).join('、')] : []),
  ];
  return `${exercise.raw_name} ${parts.join('；') || '（没有组）'}`;
}

function formatSession(detail: SessionDetail): string {
  const body = detail.exercises.map(formatExercise).join('；');
  const volume = `总容量 ${Math.round(detail.volume.total_volume_kg)}kg，${detail.volume.working_sets} 个正式组`;
  return `${detail.split_label ? `${detail.split_label}：` : ''}${body || '（没有动作）'}。${volume}`;
}

export async function answerQuery(input: {
  user_id: string;
  request: QueryRequest;
  now: Date;
}): Promise<TurnCard> {
  const hint = input.request.day_hint?.trim() || null;
  const day = hint ? tryResolveDate(hint, input.now) : null;
  if (hint && !day) {
    return chat(`没听清「${hint}」是哪天 —— 可以说「10月31号」或「昨天」。`);
  }

  const details: SessionDetail[] = [];

  if (day) {
    const sessions = await listSessions({ user_id: input.user_id, from: day, to: day });
    for (const session of sessions) {
      const detail = await getSessionDetail({ user_id: input.user_id, session_id: session.session_id });
      if (detail) details.push(detail);
    }
    if (details.length === 0) return chat(`${day} 没有训练记录。`);
  } else {
    // 没给日期：最近一条
    const [latest] = await listHistory({ user_id: input.user_id, limit: 1 });
    if (!latest) return chat('还没有训练记录，先记一次吧。');
    const detail = await getSessionDetail({ user_id: input.user_id, session_id: latest.session_id });
    if (detail) details.push(detail);
  }

  const head = day ? `${day} 的记录：` : `最近一次训练（${details[0]!.date}）：`;
  const body = details.map(formatSession).join(' ｜ ');
  return chat(`${head}${body}`);
}