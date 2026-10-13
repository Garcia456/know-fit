import { loadSeed } from '../seed/load.js';

/**
 * raw_name → exercise_id —— 纯确定性，LLM 不参与。
 *
 * 数据源是 seed 的 alias_rules，只读它声明的两类：
 *   resolvable（附 $guard）与 ambiguous（附 candidates + fallback）。
 * ⚠️ 不读 exercise.aliases 数组 —— 那里面「飞鸟」同时挂在 dumbbell_fly 上，
 *    与 ambiguous 列表打架；按定义 §1.3 的分级表，alias 数组不参与匹配。
 * ⚠️ 区域兜底表 region_fallbacks 在 dev-002 里不用（它属展示层补偿）。
 */

/** seed 的 $guard 是中文散文，这里落成关键词表 */
const GUARD_BLOCKERS: Record<string, string[]> = {
  深蹲: ['前', '哈克', '保加利亚'],
  硬拉: ['罗马尼亚', '直腿', '相扑', '六角杠'],
  弯举: ['锤式', '牧师'],
};

export type MatchLevel =
  | 1 // 精确命中 name_zh 或 resolvable.alias
  | 2 // 被 $guard 挡下后降级命中
  | 3 // 歧义 → 不强行归并
  | 4; // 未命中

export interface NormalizationResult {
  exercise_id: string | null;
  name_zh: string | null;
  region_fallback: string | null;
  level: MatchLevel;
}

type Indexed =
  | { text: string; kind: 'name'; exerciseId: string; nameZh: string }
  | { text: string; kind: 'resolvable'; exerciseId: string; nameZh: string; blockedOn: string[] }
  | { text: string; kind: 'ambiguous'; fallback: string | null };

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
      ...(prev.kind === 'resolvable' ? prev.blockedOn : []),
      ...(entry.kind === 'resolvable' ? entry.blockedOn : []),
    ];
    exact.set(entry.text, {
      text: entry.text,
      kind: 'resolvable',
      exerciseId: entry.exerciseId,
      nameZh: entry.nameZh,
      blockedOn,
    });
  };

  for (const ex of seed.exercises) {
    put({ text: normalizeKey(ex.name_zh), kind: 'name', exerciseId: ex.id, nameZh: ex.name_zh });
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
      kind: 'resolvable',
      exerciseId: r.resolves_to,
      nameZh: nameZhById.get(r.resolves_to) ?? r.resolves_to,
      blockedOn: GUARD_BLOCKERS[r.alias] ?? [],
    });
  }
  for (const r of rules?.ambiguous ?? []) {
    put({ text: normalizeKey(r.alias), kind: 'ambiguous', fallback: r.fallback ?? null });
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
  return entry.kind === 'resolvable' && entry.blockedOn.some((b) => rawKey.includes(b));
}

function toResult(entry: Indexed, level: MatchLevel, rawKey: string): NormalizationResult {
  if (entry.kind === 'ambiguous') {
    return { exercise_id: null, name_zh: null, region_fallback: entry.fallback, level: 3 };
  }
  const guardTripped = blocked(entry, rawKey);
  if (guardTripped) {
    // 被 guard 挡下的条目不该 resolve —— 走到这里说明调用方漏了一次检查
    return { exercise_id: null, name_zh: null, region_fallback: null, level: 4 };
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
  if (!key) return { exercise_id: null, name_zh: null, region_fallback: null, level: 4 };

  // 1. 精确：name_zh / resolvable（guard 没被踩）
  const hit = idx.exact.get(key);
  if (hit && !blocked(hit, key)) return toResult(hit, 1, key);

  // 2. 精确但歧义 → 不强行归并
  if (hit && hit.kind === 'ambiguous') return toResult(hit, 3, key);

  // 3. 包含匹配（长名优先）；被 guard 挡下过的算「降级命中」
  const guardTripped = hit !== undefined; // 走到这里且 hit 存在 ⇒ 它被 guard 挡下了
  for (const entry of idx.byLength) {
    if (!key.includes(entry.text)) continue;
    if (blocked(entry, key)) continue;
    if (entry.kind === 'ambiguous') return toResult(entry, 3, key);
    return toResult(entry, guardTripped ? 2 : 1, key);
  }

  return { exercise_id: null, name_zh: null, region_fallback: null, level: 4 };
}