/**
 * 20 个细分肌群 → 9 个展示组。
 *
 * 这是**展示口径**，不进动作库：
 * 动作只声明自己练哪些细分肌群；参考区间与「背 / 手臂 / 核心」这类粗组
 * 只用于统计页二级页的分布分析。
 *
 * 每个 muscle_regions.id 必须恰好属于一个组 —— `muscleGroups.test.ts` 断言。
 */
export type MuscleGroupId =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'arms'
  | 'core'
  | 'calves';

export interface MuscleGroup {
  id: MuscleGroupId;
  name_zh: string;
  /** seed muscle_regions.id */
  members: readonly string[];
  /** 参考区间按周给；非 7 天区间由调用方按天数折算 */
  weekly_low: number;
  weekly_high: number;
}

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  {
    id: 'chest',
    name_zh: '胸',
    members: ['chest'],
    weekly_low: 10,
    weekly_high: 20,
  },
  {
    id: 'back',
    name_zh: '背',
    members: ['lats', 'back_mid', 'traps_upper', 'lower_back'],
    weekly_low: 10,
    weekly_high: 20,
  },
  {
    id: 'shoulders',
    name_zh: '肩',
    members: ['delt_ant', 'delt_lat', 'delt_post'],
    weekly_low: 10,
    weekly_high: 20,
  },
  {
    id: 'quads',
    name_zh: '股四',
    members: ['quads'],
    weekly_low: 10,
    weekly_high: 20,
  },
  {
    id: 'hamstrings',
    name_zh: '腘绳',
    members: ['hamstrings'],
    weekly_low: 10,
    weekly_high: 20,
  },
  {
    id: 'glutes',
    name_zh: '臀',
    members: ['glutes', 'adductors', 'abductors'],
    weekly_low: 10,
    weekly_high: 20,
  },
  {
    id: 'arms',
    name_zh: '手臂',
    members: ['biceps', 'triceps', 'forearm'],
    weekly_low: 8,
    weekly_high: 16,
  },
  {
    id: 'core',
    name_zh: '核心',
    members: ['abs_upper', 'abs_lower', 'obliques'],
    weekly_low: 8,
    weekly_high: 16,
  },
  {
    id: 'calves',
    name_zh: '小腿',
    members: ['calves'],
    weekly_low: 8,
    weekly_high: 16,
  },
];

const GROUP_BY_MUSCLE = new Map<string, MuscleGroup>(
  MUSCLE_GROUPS.flatMap((group) => group.members.map((muscle) => [muscle, group] as const)),
);

/** 部位兜底 id → 展示用中文短词（与 seed.region_fallbacks 一一对应） */
export const REGION_FALLBACK_LABELS: Record<string, string> = {
  region_chest: '胸',
  region_back: '背',
  region_shoulder: '肩',
  region_leg: '腿',
  region_arm: '手臂',
};

/** 细分肌群 → 展示组；未知 id 返回 undefined（由配置测试兜住） */
export function groupOfMuscle(muscleId: string): MuscleGroup | undefined {
  return GROUP_BY_MUSCLE.get(muscleId);
}

/** 选定区间的参考区间 = 每周区间 × 天数 / 7；保留 1 位小数 */
export function proratedWeeklyRange(
  group: Pick<MuscleGroup, 'weekly_low' | 'weekly_high'>,
  days: number,
): { low: number; high: number } {
  const factor = Math.max(0, days) / 7;
  return {
    low: Math.round(group.weekly_low * factor * 10) / 10,
    high: Math.round(group.weekly_high * factor * 10) / 10,
  };
}
