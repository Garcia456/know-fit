import { loadSeed } from '../seed/load.js';

/**
 * raw_name → exercise_id —— 纯确定性，LLM 不参与。
 *
 * 分两层，层间**不是**先后尝试，而是权威性高低：
 *   一层（权威）：seed 的 name_zh 与 alias_rules 的 resolvable / ambiguous。
 *                 人工定过，冲突时它说了算。
 *   二层（补充）：exercise.aliases 的精确命中。
 *                 动作库会长，别名写在动作自己身上，加动作时顺手就加了。
 * ⚠️ 层间撞键时一层静默胜出 —— 「飞鸟」在 alias_rules 里判歧义（给 fallback），
 *    就不认 exercise.aliases 里挂在 dumbbell_fly 上的「飞鸟」。
 *    同一层内撞键仍是二义，当场抛。
 * ⚠️ 区域兜底表 region_fallbacks 在这里不用 —— 它属展示层补偿。
 */

/**
 * 别名的「撤销条件」：原文里出现这些限定词时，撤销对短别名的命中。
 * 没有它，「前蹲」「哈克深蹲」「保加利亚深蹲」都会被「深蹲」吃掉。
 */
const GUARD_BLOCKERS: Record<string, string[]> = {
  深蹲: ['前', '哈克', '保加利亚'],
  硬拉: ['罗马尼亚', '直腿', '相扑', '六角杠'],
  弯举: ['锤式', '牧师'],
};

export type MatchLevel =
  | 1 // 精确命中 name_zh 或 resolvable.alias
  | 2 // 歧义 → 不强行归并
  | 3; // 未命中

export interface NormalizationResult {
  exercise_id: string | null;
  name_zh: string | null;
  region_fallback: string | null;
  level: MatchLevel;
}

/** 1 = 权威层（name_zh / alias_rules），2 = 补充层（exercise.aliases） */
type Tier = 1 | 2;

type Indexed = { text: string; tier: Tier } & (
  | { kind: 'name'; exerciseId: string; nameZh: string }
  | { kind: 'resolvable'; exerciseId: string; nameZh: string; blockedOn: string[] }
  | { kind: 'alias'; exerciseId: string; nameZh: string; blockedOn: string[] }
  | { kind: 'ambiguous'; fallback: string | null }
);

export interface ExerciseIndex {
  exact: Map<string, Indexed>;
  /** 包含匹配用，按 text 长度降序 */
  byLength: Indexed[];
}

/** 去空白与标点，避免「卧推（杠铃）」「卧推,」这类噪声（\s 已含全角空格 U+3000） */
export function normalizeKey(s: string): string {
  return s
    .replace(/\s/g, '')
    .replace(/[（）()【】「」『』，,。.、·:：;；!！?？'"“”‘’\-—_/\\|+*×°%[\]]/g, '')
    .toLowerCase();
}

export function buildIndex(): ExerciseIndex {
  const seed = loadSeed();
  const nameZhById = new Map(seed.exercises.map((e) => [e.id, e.name_zh]));
  const exact = new Map<string, Indexed>();

  const put = (entry: Indexed): void => {
    const prev = exact.get(entry.text);
    if (!prev) {
      exact.set(entry.text, entry);
      return;
    }

    // 层间撞键：权威层说了算，另一层静默让位（不是二义，不抛）
    if (prev.tier < entry.tier) return;
    if (entry.tier < prev.tier) {
      exact.set(entry.text, entry);
      return;
    }

    // 歧义 vs 确定 = 真正的二义，当场炸
    if (prev.kind === 'ambiguous' || entry.kind === 'ambiguous') {
      throw new Error(
        `别名索引键冲突：「${entry.text}」一边说歧义、一边给确定 id —— 需要人工定归并规则`,
      );
    }
    // 同 id 的两种来源（seed 里「硬拉」「提踵」「面拉」既是 name_zh 又是 resolvable 别名）
    if (prev.exerciseId !== entry.exerciseId) {
      throw new Error(
        `别名键「${entry.text}」指向两个不同 id：${prev.exerciseId} / ${entry.exerciseId} —— 需要人工定归并规则`,
      );
    }
    // 合并时**必须保住 guard** —— 丢了它，「直腿硬拉」就会被吞成 deadlift
    const blockedOn = [
      ...(prev.kind === 'resolvable' || prev.kind === 'alias' ? prev.blockedOn : []),
      ...(entry.kind === 'resolvable' || entry.kind === 'alias' ? entry.blockedOn : []),
    ];
    exact.set(entry.text, {
      text: entry.text,
      tier: entry.tier,
      kind: 'resolvable',
      exerciseId: entry.exerciseId,
      nameZh: entry.nameZh,
      blockedOn,
    });
  };

  for (const ex of seed.exercises) {
    put({
      text: normalizeKey(ex.name_zh),
      tier: 1,
      kind: 'name',
      exerciseId: ex.id,
      nameZh: ex.name_zh,
    });
  }

  const rules = seed.alias_rules as
    | {
        resolvable?: { alias: string; resolves_to: string; $guard?: string }[];
        ambiguous?: { alias: string; fallback?: string | null }[];
      }
    | undefined;

  for (const r of rules?.resolvable ?? []) {
    put({
      text: normalizeKey(r.alias),
      tier: 1,
      kind: 'resolvable',
      exerciseId: r.resolves_to,
      nameZh: nameZhById.get(r.resolves_to) ?? r.resolves_to,
      blockedOn: GUARD_BLOCKERS[r.alias] ?? [],
    });
  }
  for (const r of rules?.ambiguous ?? []) {
    put({ text: normalizeKey(r.alias), tier: 1, kind: 'ambiguous', fallback: r.fallback ?? null });
  }

  // 补充层：别名写在动作自己身上，动作库长了这里自动跟上
  for (const ex of seed.exercises) {
    for (const alias of ex.aliases) {
      put({
        text: normalizeKey(alias),
        tier: 2,
        kind: 'alias',
        exerciseId: ex.id,
        nameZh: ex.name_zh,
        blockedOn: GUARD_BLOCKERS[alias] ?? [],
      });
    }
  }

  const byLength = [...exact.values()].sort((a, b) => b.text.length - a.text.length);
  return { exact, byLength };
}

let cached: ExerciseIndex | null = null;
function index(): ExerciseIndex {
  cached ??= buildIndex();
  return cached;
}

function blocked(entry: Indexed, rawKey: string): boolean {
  return (
    (entry.kind === 'resolvable' || entry.kind === 'alias') &&
    entry.blockedOn.some((b) => rawKey.includes(b))
  );
}

function toResult(entry: Indexed, level: MatchLevel, rawKey: string): NormalizationResult {
  if (entry.kind === 'ambiguous') {
    return { exercise_id: null, name_zh: null, region_fallback: entry.fallback, level: 2 };
  }
  if (blocked(entry, rawKey)) {
    // 被 guard 挡下的条目不该 resolve —— 走到这里说明调用方漏了一次检查
    return { exercise_id: null, name_zh: null, region_fallback: null, level: 3 };
  }
  return {
    exercise_id: entry.exerciseId,
    name_zh: entry.nameZh,
    region_fallback: null,
    level,
  };
}

/** 把 LLM 抽出的动作名归一到 seed 的 exercise_id */
export function normalizeExerciseName(rawName: string): NormalizationResult {
  const key = normalizeKey(rawName);
  const idx = index();
  if (!key) return { exercise_id: null, name_zh: null, region_fallback: null, level: 3 };

  // 1. 精确：name_zh / resolvable（guard 没被踩）
  const hit = idx.exact.get(key);
  if (hit && !blocked(hit, key)) return toResult(hit, 1, key);

  // 2. 精确但歧义 → 不强行归并
  if (hit && hit.kind === 'ambiguous') return toResult(hit, 2, key);

  // 3. 包含匹配（长名优先）
  for (const entry of idx.byLength) {
    if (!key.includes(entry.text)) continue;
    if (blocked(entry, key)) continue;
    if (entry.kind === 'ambiguous') return toResult(entry, 2, key);
    return toResult(entry, 1, key);
  }

  return { exercise_id: null, name_zh: null, region_fallback: null, level: 3 };
}