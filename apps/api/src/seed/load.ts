import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 动作与肌群映射表的路径（随 api 包一起走） */
export const SEED_PATH = join(HERE, '..', '..', 'seed', 'exercises.json');

const MuscleRegionSchema = z.object({
  id: z.string(),
  name_zh: z.string(),
  name_en: z.string(),
  face: z.enum(['front', 'back']),
  coarse: z.string(),
});

const ExerciseSchema = z.object({
  id: z.string(),
  name_zh: z.string(),
  aliases: z.array(z.string()),
  equipment: z.array(z.string()),
  // nullable：核心类动作（举腿 / 转体 / 健腹轮 / 髋外展内收）没有"推 / 拉"的力学分类。
  // 实测数据里 63 条中有 5 条为 null —— 这不是数据缺失，是分类本身不适用。
  mechanic: z.string().nullable(),
  primary_muscles: z.array(z.string()),
  secondary_muscles: z.array(z.string()),
  coarse: z.array(z.string()),
});

const RegionFallbackSchema = z.object({
  id: z.string(),
  covers: z.array(z.string()),
  triggers: z.array(z.string()),
});

export const SeedSchema = z.object({
  $schema_version: z.string(),
  $source: z.string(),
  $generated: z.string(),
  $counts: z.object({
    muscle_regions: z.number().int(),
    exercises: z.number().int(),
    region_fallbacks: z.number().int(),
  }),
  $notes: z.array(z.string()),
  muscle_regions: z.array(MuscleRegionSchema),
  exercises: z.array(ExerciseSchema),
  region_fallbacks: z.array(RegionFallbackSchema),
  alias_rules: z.unknown().optional(),
});

export type Seed = z.infer<typeof SeedSchema>;
export type MuscleRegion = z.infer<typeof MuscleRegionSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;

/**
 * 读入并校验 seed 数据。
 *
 * 校验两层：
 *   1. 结构（Zod schema）—— 字段缺失 / 类型不对当场报错；
 *   2. 引用完整性 —— 所有 primary/secondary muscle 与 fallback.covers
 *      必须是 muscle_regions 里已定义的 id（**无未知 muscle id**）。
 *
 * 第 2 层是必须有的 ——
 * 一个拼错的 muscle id 不会让 JSON 坏掉，但会让热力图少亮一块，
 * 且那种 bug 极难从界面上看出来。
 */
export function loadSeed(path: string = SEED_PATH): Seed {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const seed = SeedSchema.parse(raw);

  const known = new Set(seed.muscle_regions.map((m) => m.id));
  const unknown: string[] = [];

  for (const ex of seed.exercises) {
    for (const m of [...ex.primary_muscles, ...ex.secondary_muscles]) {
      if (!known.has(m)) unknown.push(`exercise ${ex.id} → ${m}`);
    }
  }
  for (const fb of seed.region_fallbacks) {
    for (const m of fb.covers) {
      if (!known.has(m)) unknown.push(`fallback ${fb.id} → ${m}`);
    }
  }

  if (unknown.length) {
    throw new Error(`seed 数据引用了未知 muscle id：\n  ${unknown.join('\n  ')}`);
  }
  return seed;
}