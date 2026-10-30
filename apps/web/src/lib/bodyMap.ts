import { BACK_MUSCLES, FRONT_MUSCLES, type MuscleDef } from 'body-muscles';

/**
 * body-muscles 的 89 个解剖区 → 本项目的 20 区。
 * 只取路径数据，自己渲染 SVG；不用库的 BodyChart / 配色。
 */

export const REGION_IDS = [
  'chest',
  'delt_ant',
  'delt_lat',
  'biceps',
  'forearm',
  'abs_upper',
  'abs_lower',
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
  abs_upper: '腹直肌上部',
  abs_lower: '腹直肌下部',
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

/** 60 个库 id；左右两侧都指向同一块项目肌群 */
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

  // 库里的 abs-upper 是肋骨侧条，归到腹斜肌；真正的腹直肌上四块在 obliques / serratus 复合路径里
  'abs-upper-left': 'obliques',
  'abs-upper-right': 'obliques',
  'abs-lower-left': 'abs_lower',
  'abs-lower-right': 'abs_lower',

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

/** 25 个不参与上色的解剖区：头 / 脸 / 颈 / 手 / 脚 / 膝 / 肘 / 髋屈肌 / 脊柱 */
export const UNMAPPED_LIBRARY_IDS = [
  'head',
  'face',
  'neck-right',
  'neck-left',
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

/** 臀大肌亮时，臀中肌让位 —— 只留臀大肌轮廓，线条不来回折 */
export const GLUTE_MEDIUS_PATHS = BODY_PATHS.filter((m) => m.id.startsWith('gluteus-medius')).map(
  (m) => m.path,
);

interface PathPiece {
  region: RegionId;
  d: string;
}

/** 复合路径按子路径拆开，坐标一律转成绝对（库里有的子路径用相对 m 起始） */
function splitSubpaths(id: string): string[] {
  const m = BODY_PATHS.find((p) => p.id === id);
  if (!m) return [];
  const tokens = m.path.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const subs: [number, number][][] = [];
  let points: [number, number][] | null = null;
  let cmd = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i]!;
    if (/[a-zA-Z]/.test(token)) {
      cmd = token;
      i++;
      if (cmd === 'z' || cmd === 'Z') {
        x = startX;
        y = startY;
      }
      if (cmd === 'm' || cmd === 'M') {
        points = [];
        subs.push(points);
      }
      continue;
    }
    const a = Number(tokens[i]);
    const b = Number(tokens[i + 1]);
    i += 2;
    const relative = cmd === cmd.toLowerCase();
    x = relative ? x + a : a;
    y = relative ? y + b : b;
    points?.push([x, y]);
    if (cmd === 'm' || cmd === 'M') {
      startX = x;
      startY = y;
      cmd = cmd === 'm' ? 'l' : 'L';
    }
  }
  return subs
    .filter((pts) => pts.length > 0)
    .map(
      (pts) =>
        `${pts.map(([px, py], k) => `${k ? 'L' : 'M'} ${+px.toFixed(3)} ${+py.toFixed(3)}`).join(' ')} Z`,
    );
}

/** 前两块是腹直肌第二、三排，第三块才是侧腹 */
function obliquePieces(side: 'left' | 'right'): PathPiece[] {
  const [first, second, lateral] = splitSubpaths(`obliques-${side}`);
  return [
    { region: 'abs_upper', d: first! },
    { region: 'abs_upper', d: second! },
    { region: 'obliques', d: lateral! },
  ];
}

/** 最上面一段是腹直肌第一排，其余三块才是前锯肌 */
function serratusPieces(side: 'left' | 'right'): PathPiece[] {
  const [top, ...fingers] = splitSubpaths(`serratus-anterior-${side}`);
  return [
    { region: 'abs_upper', d: top! },
    ...fingers.map((d) => ({ region: 'obliques' as const, d })),
  ];
}

/**
 * 库路径与项目区域的几何改写：拆块 / 收边。
 * 未列出的 id 按 LIBRARY_TO_REGION 整条渲染。
 */
const CUSTOM_PATH_PIECES: Record<string, PathPiece[]> = {
  'obliques-left': obliquePieces('left'),
  'obliques-right': obliquePieces('right'),
  'serratus-anterior-left': serratusPieces('left'),
  'serratus-anterior-right': serratusPieces('right'),
  // 腹直肌下四块：按 y=40 横切成上下两行
  'abs-lower-left': [
    { region: 'abs_lower', d: 'M 16.567 39.9 L 16.658 39.007 L 16.674 35.158 L 18.858 34.083 L 19.062 39.9 Z' },
    { region: 'abs_lower', d: 'M 16.052 44.919 L 16.551 40.05 L 19.068 40.05 L 19.105 41.113 Z' },
  ],
  'abs-lower-right': [
    { region: 'abs_lower', d: 'M 15.121 39.9 L 15.03 39.008 L 15.015 35.159 L 12.83 34.084 L 12.625 39.9 Z' },
    { region: 'abs_lower', d: 'M 15.636 44.92 L 15.137 40.05 L 12.62 40.05 L 12.582 41.114 Z' },
  ],
  // 中斜方 / 下斜方各缩 0.78 —— 跟斜方上部、后束、背阔肌之间都留出缝
  'traps-mid-left': [
    { region: 'back_mid', d: 'M 46.768 17.609 L 49.019 21.392 L 50.879 21.392 L 50.816 17.609 Z' },
  ],
  'traps-mid-right': [
    { region: 'back_mid', d: 'M 58.349 17.609 L 56.099 21.392 L 54.195 21.392 L 54.256 17.609 Z' },
  ],
  'traps-lower-left': [
    { region: 'back_mid', d: 'M 49.298 22.459 L 49.737 23.197 L 51.165 27.161 L 51.089 22.459 Z' },
  ],
  'traps-lower-right': [
    { region: 'back_mid', d: 'M 55.816 22.459 L 55.33 23.197 L 53.902 27.161 L 53.98 22.459 Z' },
  ],
};

/** 原图不画（作者定：下背四块留白）；数据仍按 lower_back 计入 */
const HIDDEN_LIBRARY_IDS = new Set([
  'lower-back-erectors-left',
  'lower-back-erectors-right',
  'lower-back-ql-left',
  'lower-back-ql-right',
]);

/** 上图时不画的区：有数据，但不落在任何路径上 */
const NOT_RENDERED_REGIONS = new Set<RegionId>(['lower_back']);

/** 渲染前的契约校验：返回空数组才算过。 */
export function validateBodyMap(): string[] {
  const problems: string[] = [];
  const ids = new Set(BODY_PATHS.map((m) => m.id));

  if (REGION_IDS.length !== 20) problems.push(`项目肌群应为 20 个，实际 ${REGION_IDS.length}`);

  const mappedTargets = new Set<RegionId>([
    ...Object.values(LIBRARY_TO_REGION),
    ...Object.values(CUSTOM_PATH_PIECES).flatMap((pieces) => pieces.map((p) => p.region)),
  ]);
  for (const region of REGION_IDS) {
    if (!mappedTargets.has(region)) problems.push(`映射表没有覆盖 ${region}`);
  }

  for (const id of Object.keys(LIBRARY_TO_REGION)) {
    if (!ids.has(id)) problems.push(`映射表里的库 id 不存在：${id}`);
  }
  for (const id of [...Object.keys(CUSTOM_PATH_PIECES), ...HIDDEN_LIBRARY_IDS]) {
    if (!ids.has(id)) problems.push(`改写表里的库 id 不存在：${id}`);
  }
  for (const id of Object.keys(CUSTOM_PATH_PIECES)) {
    if (HIDDEN_LIBRARY_IDS.has(id)) problems.push(`库路径既被改写又被隐藏：${id}`);
  }

  const unmapped = new Set<string>(UNMAPPED_LIBRARY_IDS);
  for (const m of BODY_PATHS) {
    const mapped = Object.hasOwn(LIBRARY_TO_REGION, m.id) || Object.hasOwn(CUSTOM_PATH_PIECES, m.id);
    if (!mapped && !unmapped.has(m.id)) problems.push(`库路径既未映射也不在豁免清单：${m.id}`);
    if (mapped && unmapped.has(m.id)) problems.push(`库路径同时被映射与豁免：${m.id}`);
  }

  const rendered = new Set<RegionId>();
  for (const m of BODY_PATHS) {
    if (HIDDEN_LIBRARY_IDS.has(m.id)) continue;
    const custom = CUSTOM_PATH_PIECES[m.id];
    if (custom) {
      for (const piece of custom) rendered.add(piece.region);
      continue;
    }
    const region = LIBRARY_TO_REGION[m.id];
    if (region) rendered.add(region);
  }

  for (const region of REGION_IDS) {
    if (!rendered.has(region) && !NOT_RENDERED_REGIONS.has(region)) {
      problems.push(`没有任何库路径落到 ${region}`);
    }
  }

  return problems;
}

/** 某一面的渲染单元：映射到 20 区的分组 + 不参与上色的剪影路径 */
export function viewPaths(view: 'FRONT' | 'BACK'): {
  groups: { region: RegionId; paths: string[] }[];
  silhouettes: string[];
} {
  const source = BODY_PATHS.filter((m) => m.view === view);
  const groups = new Map<RegionId, string[]>();
  const silhouettes: string[] = [];

  const push = (region: RegionId, d: string): void => {
    const bucket = groups.get(region) ?? [];
    bucket.push(d);
    groups.set(region, bucket);
  };

  for (const m of source) {
    if (HIDDEN_LIBRARY_IDS.has(m.id)) continue;
    const custom = CUSTOM_PATH_PIECES[m.id];
    if (custom) {
      for (const piece of custom) push(piece.region, piece.d);
      continue;
    }
    const region = LIBRARY_TO_REGION[m.id];
    if (!region) {
      silhouettes.push(m.path);
      continue;
    }
    push(region, m.path);
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