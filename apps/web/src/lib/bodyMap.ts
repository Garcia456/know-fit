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
  'deltoid-rear-left': 'delt_lat',
  'deltoid-rear-right': 'delt_lat',

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
  // 臀中肌不画：库里那块三角留空，髋外展的色不上图
  'gluteus-medius-left': [],
  'gluteus-medius-right': [],
  // 下背不画，腰往下由背阔肌最下面一块拉长补上
  'lower-back-erectors-left': [],
  'lower-back-erectors-right': [],
  'lower-back-ql-left': [],
  'lower-back-ql-right': [],
  // 背阔肌最下一块往下留一段，臀线由臀大肌向上补
  'gluteus-maximus-left': [
    {
      region: 'glutes',
      d: 'M 50.6 40.9 L 44.3 43.3 L 44.41 50.52 L 47.18 51.03 L 51.62 49.09 L 52.2 49.48 L 52.2 41.6 Z',
    },
  ],
  'gluteus-maximus-right': [
    {
      region: 'glutes',
      d: 'M 54.95 40.9 L 52.8 41.7 L 52.8 49.48 L 53.57 49.09 L 57.68 50.76 L 60.5 50.6 L 60.85 43.4 Z',
    },
  ],
  // 背阔肌最下一块往下留一段
  'lats-lower-left': [
    {
      region: 'lats',
      d: 'M 47.1 33.7 L 51.5 33.5 C 51.65 36 52 38.9 52.3 41.2 L 50.9 40.8 L 45.4 41.7 C 46.4 38.9 46.9 36.4 47.1 33.7 Z',
    },
  ],
  'lats-lower-right': [
    {
      region: 'lats',
      d: 'M 57.96 33.7 L 53.56 33.5 C 53.41 36 53.06 38.9 52.76 41.2 L 54.16 40.8 L 59.66 41.7 C 58.66 38.9 58.16 36.4 57.96 33.7 Z',
    },
  ],
  // 中间两块往下延伸，边界往下挪；外缘往里凹，越到底越甩出去
  'lats-mid-left': [
    {
      region: 'lats',
      d: 'M 45.771 24.6 L 49.185 24.6 L 51.053 29.314 L 51.5 33.4 L 47.1 33.2 C 47.5 31.2 47.01 30.29 45.872 24.789 Z',
    },
  ],
  'lats-mid-right': [
    {
      region: 'lats',
      d: 'M 59.347 24.6 L 55.918 24.6 L 54.012 29.413 L 53.56 33.4 L 57.96 33.2 C 57.56 31.2 58.05 30.385 59.188 24.888 Z',
    },
  ],
    // 中束在库里那块偏小，往外、往上放宽一点
  'deltoid-rear-left': [
    { region: 'delt_lat', d: 'M 41.9 16.33 L 40.33 17.89 L 39.736 20.156 L 44.32 14.77 Z' },
  ],
  'deltoid-rear-right': [
    { region: 'delt_lat', d: 'M 63.1 16.33 L 64.67 17.89 L 65.264 20.156 L 60.68 14.77 Z' },
  ],
  // 背阔肌上块：整片折翼切给后束，留下的部分不再带尖端
  'lats-upper-left': [
    {
      region: 'lats',
      d: 'M 45.05 17.5 L 44.025 20.355 L 45.663 24.4 L 49.103 24.4 Z',
    },
    {
      region: 'delt_post',
      d: 'M 45.15 15.8 L 40.9 19.05 L 39.426 22.249 L 41.109 20.641 L 43.649 19.72 Z',
    },
  ],
  'lats-upper-right': [
    {
      region: 'lats',
      d: 'M 59.95 17.5 L 61.039 20.454 L 59.455 24.4 L 56.022 24.4 Z',
    },
    {
      region: 'delt_post',
      d: 'M 59.85 15.8 L 64.1 19.05 L 65.574 22.249 L 63.891 20.641 L 61.351 19.72 Z',
    },
  ],
};

/** 上图时不画的区：有数据，但不落在任何路径上 */
const NOT_RENDERED_REGIONS = new Set<RegionId>(['abductors', 'lower_back']);

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
  for (const id of Object.keys(CUSTOM_PATH_PIECES)) {
    if (!ids.has(id)) problems.push(`改写表里的库 id 不存在：${id}`);
  }

  const unmapped = new Set<string>(UNMAPPED_LIBRARY_IDS);
  for (const m of BODY_PATHS) {
    const mapped = Object.hasOwn(LIBRARY_TO_REGION, m.id) || Object.hasOwn(CUSTOM_PATH_PIECES, m.id);
    if (!mapped && !unmapped.has(m.id)) problems.push(`库路径既未映射也不在豁免清单：${m.id}`);
    if (mapped && unmapped.has(m.id)) problems.push(`库路径同时被映射与豁免：${m.id}`);
  }

  const rendered = new Set<RegionId>();
  for (const m of BODY_PATHS) {
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
    // 按项目肌群顺序画，臀中肌压在臀大肌之上（臀大肌上缘已盖住它）
    groups: [...groups.entries()]
      .sort(([a], [b]) => REGION_IDS.indexOf(a) - REGION_IDS.indexOf(b))
      .map(([region, paths]) => ({ region, paths })),
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