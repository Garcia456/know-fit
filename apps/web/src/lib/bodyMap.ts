import { BACK_MUSCLES, FRONT_MUSCLES, type MuscleDef } from 'body-muscles';

/**
 * body-muscles 的 89 个解剖区 → 本项目的 19 区。
 * 只取路径数据，自己渲染 SVG；不用库的 BodyChart / 配色。
 */

export const REGION_IDS = [
  'chest',
  'delt_ant',
  'delt_lat',
  'biceps',
  'forearm',
  'abs',
  'obliques',
  'quads',
  'adductors',
  'traps_upper',
  'back_mid',
  'lats',
  'delt_post',
  'triceps',
  'lower_back',
  'glutes',
  'abductors',
  'hamstrings',
  'calves',
] as const;

export type RegionId = (typeof REGION_IDS)[number];

export const REGION_NAMES: Record<RegionId, string> = {
  chest: '胸大肌',
  delt_ant: '三角肌前束',
  delt_lat: '三角肌中束',
  biceps: '肱二头肌',
  forearm: '前臂',
  abs: '腹直肌',
  obliques: '腹斜肌',
  quads: '股四头肌',
  adductors: '内收肌群',
  traps_upper: '斜方肌上部',
  back_mid: '中背',
  lats: '背阔肌',
  delt_post: '三角肌后束',
  triceps: '肱三头肌',
  lower_back: '竖脊肌（下背）',
  glutes: '臀大肌',
  abductors: '外展肌群',
  hamstrings: '腘绳肌',
  calves: '小腿',
};

/** 62 个库 id；左右两侧都指向同一块项目肌群 */
export const LIBRARY_TO_REGION: Record<string, RegionId> = {
  'chest-upper-left': 'chest',
  'chest-upper-right': 'chest',
  'chest-lower-left': 'chest',
  'chest-lower-right': 'chest',

  'shoulder-front-left': 'delt_ant',
  'shoulder-front-right': 'delt_ant',
  'shoulder-side-left': 'delt_lat',
  'shoulder-side-right': 'delt_lat',
  'deltoid-rear-left': 'delt_post',
  'deltoid-rear-right': 'delt_post',

  'biceps-left': 'biceps',
  'biceps-right': 'biceps',

  'forearm-left': 'forearm',
  'forearm-right': 'forearm',
  'forearm-flexors-left': 'forearm',
  'forearm-flexors-right': 'forearm',
  'forearm-extensors-left': 'forearm',
  'forearm-extensors-right': 'forearm',

  'abs-upper-left': 'abs',
  'abs-upper-right': 'abs',
  'abs-lower-left': 'abs',
  'abs-lower-right': 'abs',
  'obliques-left': 'obliques',
  'obliques-right': 'obliques',

  'quads-left': 'quads',
  'quads-right': 'quads',
  'adductors-left': 'adductors',
  'adductors-right': 'adductors',

  'traps-upper-left': 'traps_upper',
  'traps-upper-right': 'traps_upper',
  'traps-mid-left': 'back_mid',
  'traps-mid-right': 'back_mid',
  'traps-lower-left': 'back_mid',
  'traps-lower-right': 'back_mid',

  'lats-upper-left': 'lats',
  'lats-upper-right': 'lats',
  'lats-mid-left': 'lats',
  'lats-mid-right': 'lats',
  'lats-lower-left': 'lats',
  'lats-lower-right': 'lats',

  'triceps-long-left': 'triceps',
  'triceps-long-right': 'triceps',
  'triceps-lateral-left': 'triceps',
  'triceps-lateral-right': 'triceps',

  'lower-back-erectors-left': 'lower_back',
  'lower-back-erectors-right': 'lower_back',
  'lower-back-ql-left': 'lower_back',
  'lower-back-ql-right': 'lower_back',

  'gluteus-maximus-left': 'glutes',
  'gluteus-maximus-right': 'glutes',
  'gluteus-medius-left': 'abductors',
  'gluteus-medius-right': 'abductors',

  'hamstrings-medial-left': 'hamstrings',
  'hamstrings-medial-right': 'hamstrings',
  'hamstrings-lateral-left': 'hamstrings',
  'hamstrings-lateral-right': 'hamstrings',

  'calves-gastroc-medial-left': 'calves',
  'calves-gastroc-medial-right': 'calves',
  'calves-gastroc-lateral-left': 'calves',
  'calves-gastroc-lateral-right': 'calves',
  'calves-soleus-left': 'calves',
  'calves-soleus-right': 'calves',
};

/** 27 个不参与上色的解剖区：头 / 脸 / 颈 / 手 / 脚 / 膝 / 肘 / 前锯肌 / 髋屈肌 / 脊柱 */
export const UNMAPPED_LIBRARY_IDS = [
  'head',
  'face',
  'neck-right',
  'neck-left',
  'serratus-anterior-left',
  'serratus-anterior-right',
  'hip-flexor-right',
  'hip-flexor-left',
  'knee-left',
  'knee-right',
  'elbow-right',
  'elbow-left',
  'hand-right',
  'hand-left',
  'foot-left',
  'foot-right',
  'tibialis-anterior-left',
  'tibialis-anterior-right',
  'head-back',
  'nape',
  'spine',
  'knee-back-left',
  'knee-back-right',
  'hand-back-left',
  'hand-back-right',
  'foot-back-left',
  'foot-back-right',
] as const;

export const BODY_PATHS: MuscleDef[] = [...FRONT_MUSCLES, ...BACK_MUSCLES];

/** 渲染前的契约校验：返回空数组才算过。 */
export function validateBodyMap(): string[] {
  const problems: string[] = [];
  const ids = new Set(BODY_PATHS.map((m) => m.id));

  if (REGION_IDS.length !== 19) problems.push(`项目肌群应为 19 个，实际 ${REGION_IDS.length}`);

  const mappedTargets = new Set(Object.values(LIBRARY_TO_REGION));
  for (const region of REGION_IDS) {
    if (!mappedTargets.has(region)) problems.push(`映射表没有覆盖 ${region}`);
  }

  for (const id of Object.keys(LIBRARY_TO_REGION)) {
    if (!ids.has(id)) problems.push(`映射表里的库 id 不存在：${id}`);
  }

  const unmapped = new Set<string>(UNMAPPED_LIBRARY_IDS);
  for (const m of BODY_PATHS) {
    const mapped = Object.hasOwn(LIBRARY_TO_REGION, m.id);
    if (!mapped && !unmapped.has(m.id)) problems.push(`库路径既未映射也不在豁免清单：${m.id}`);
    if (mapped && unmapped.has(m.id)) problems.push(`库路径同时被映射与豁免：${m.id}`);
  }

  const rendered = new Set(BODY_PATHS.filter((m) => Object.hasOwn(LIBRARY_TO_REGION, m.id)).map((m) => LIBRARY_TO_REGION[m.id]));
  for (const region of REGION_IDS) {
    if (!rendered.has(region)) problems.push(`没有任何库路径落到 ${region}`);
  }

  return problems;
}

/** 某一面的渲染单元：映射到 19 区的分组 + 不参与上色的剪影路径 */
export function viewPaths(view: 'FRONT' | 'BACK'): {
  groups: { region: RegionId; paths: string[] }[];
  silhouettes: string[];
} {
  const source = BODY_PATHS.filter((m) => m.view === view);
  const groups = new Map<RegionId, string[]>();
  const silhouettes: string[] = [];

  for (const m of source) {
    const region = LIBRARY_TO_REGION[m.id];
    if (!region) {
      silhouettes.push(m.path);
      continue;
    }
    const bucket = groups.get(region) ?? [];
    bucket.push(m.path);
    groups.set(region, bucket);
  }

  return {
    groups: [...groups.entries()].map(([region, paths]) => ({ region, paths })),
    silhouettes,
  };
}

export type HeatTier = 0 | 1 | 2 | 3 | 4;

/**
 * 训练量 → 5 档。按当前范围最大值归一；0 / 缺失 / 非有限值都是 0 档。
 * 分摊与求和已在服务端做完，这里只上色。
 */
export function computeHeatTiers(byMuscle: Record<string, number>): Record<RegionId, HeatTier> {
  const values = REGION_IDS.map((region) => {
    const v = byMuscle[region] ?? 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const max = Math.max(...values);

  return Object.fromEntries(
    REGION_IDS.map((region, i) => {
      const value = values[i] ?? 0;
      if (max <= 0 || value <= 0) return [region, 0];
      return [region, Math.min(4, Math.max(1, Math.ceil((value / max) * 4)))];
    }),
  ) as Record<RegionId, HeatTier>;
}

/** 把选中日的多条 session 按肌群求和 */
export function sumByMuscle(rows: Record<string, number>[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const row of rows) {
    for (const [region, value] of Object.entries(row)) {
      if (!Number.isFinite(value)) continue;
      total[region] = (total[region] ?? 0) + value;
    }
  }
  return total;
}