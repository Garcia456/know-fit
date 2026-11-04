import type { QueryRequest } from '../contracts/extraction.js';
import type { SessionDetail, SessionExercise } from '../contracts/sessions.js';
import type { TurnCard } from '../contracts/turn.js';
import { toLocalDate, tryResolveDate } from '../extraction/dates.js';
import { getSessionDetail, listHistory, listSessions } from './history.js';
import { statsRange } from './metrics.js';

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

export interface RangeQuery {
  label: string;
  from: string;
  to: string;
}

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 「十几」「二十几」这类中文数字；认不出返回 null */
function parseCount(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw.includes('十')) {
    const [tens, ones] = raw.split('十');
    const t = tens ? CN_NUM[tens] : 1;
    const o = ones ? CN_NUM[ones] : 0;
    if (t === undefined || o === undefined) return null;
    return t * 10 + o;
  }
  return CN_NUM[raw] ?? null;
}

function mondayOf(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** 区间问法 → 自然周范围；周一为一周起点。认不出返回 null。 */
export function rangeIn(hint: string | null, now: Date): RangeQuery | null {
  if (!hint) return null;
  const today = toLocalDate(now);
  const thisMonday = mondayOf(now);

  // 「上周日」「本周三」是具体某天，不是整周
  if (/上个?星期[日天末]|上周[日天末]|[本这][周星期][一二三四五六日天末]/.test(hint)) return null;

  if (/上个?星期|上周/.test(hint)) {
    return {
      label: '上周',
      from: toLocalDate(addDays(thisMonday, -7)),
      to: toLocalDate(addDays(thisMonday, -1)),
    };
  }
  if (/本[周星期]|这[周星期]/.test(hint)) {
    return { label: '本周', from: toLocalDate(thisMonday), to: today };
  }

  const recent = hint.match(
    /(?:最近|近|过去)\s*([1-9]\d?|[一二两三四五六七八九十]+)\s*(?:个)?(?:周|星期)/,
  );
  if (recent) {
    const n = parseCount(recent[1]!);
    if (n === null) return null;
    const weeks = Math.min(Math.max(n, 1), 26);
    return {
      label: `最近 ${weeks} 周`,
      from: toLocalDate(addDays(thisMonday, -7 * (weeks - 1))),
      to: today,
    };
  }
  return null;
}

export async function answerQuery(input: {
  user_id: string;
  request: QueryRequest;
  now: Date;
}): Promise<TurnCard> {
  const hint = input.request.day_hint?.trim() || null;

  // 区间优先：本周 / 上周 / 最近 N 周按自然周统计；无数据也如实说
  const range = rangeIn(hint, input.now);
  if (range) {
    const stats = await statsRange({ user_id: input.user_id, from: range.from, to: range.to });
    const span = `${range.from} 至 ${range.to}`;
    if (stats.training_days === 0) {
      return chat(`${range.label}（${span}）没有训练记录。`);
    }
    return chat(
      `${range.label}（${span}）：练了 ${stats.training_days} 天，` +
        `总容量 ${Math.round(stats.total_volume_kg)}kg，${stats.working_sets} 个正式组。`,
    );
  }

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