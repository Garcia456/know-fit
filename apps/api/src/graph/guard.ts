import { z } from 'zod';
import type { RefusalReason } from '../contracts/turn.js';

/**
 * 红线规则表 —— 纯确定性，不交给 LLM（LLM 的失败模式是「过于热心地给了建议」）。
 *
 * ⚠️ 两个方向的失败都要认：**漏拦**（真红线没拦住）与**误拦**（正常训练被拦）。
 *    因此 `off_topic` 刻意**不做关键词兜底** —— 负向分类误拦率高，
 *    无关话题交给意图分类去走 chat 出口。
 */

export const GuardVerdictSchema = z.enum([
  'pass',
  'reject_medical',
  'reject_extreme',
  'off_topic',
  'non_target_user',
]);
export type GuardVerdict = z.infer<typeof GuardVerdictSchema>;

export interface GuardHit {
  verdict: Exclude<GuardVerdict, 'pass'>;
  reason: RefusalReason | 'non_target';
  /** 命中的那个词 —— 排查时要看得出「为什么拦」 */
  matched: string;
}

const MEDICAL = [
  '疼', '痛', '受伤', '拉伤', '扭伤', '腰突', '骨折', '韧带', '半月板',
  '撕裂', '发炎', '炎症', '麻木', '手术', '康复', '伤病', '止痛',
];

/** 药 / 补剂词与剂量词**联判** —— 否则「今天该吃多少饭」会被误拦成用药 */
const MEDICATION = ['类固醇', '激素', '药物', '处方', '用药', '吃药', '补剂', '肌酸', '蛋白粉'];
const DOSE = ['吃多少', '用量', '剂量', '多少克', '几粒', '几片', '几勺', '怎么吃', '喝多少'];

const EXTREME_DIET = ['催吐', '绝食', '泻药', '减肥药', '瘦十斤', '掉十斤', '一周瘦', '暴食', '只喝水'];

const NON_TARGET = ['未成年', '初中生', '小学生', '心脏病', '高血压', '糖尿病', '哮喘'];
/** 6–17 岁 —— 不写成 \d+，免得「40 岁」被拦 */
const NON_TARGET_AGE = /(^|[^0-9])([6-9]|1[0-7])\s*岁/;

function firstHit(message: string, words: string[]): string | null {
  return words.find((w) => message.includes(w)) ?? null;
}

/** 顺序即优先级：伤病 > 用药 > 极端饮食 > 非目标人群 */
export function checkGuard(message: string): GuardHit | null {
  const medical = firstHit(message, MEDICAL);
  if (medical) return { verdict: 'reject_medical', reason: 'medical', matched: medical };

  const drug = firstHit(message, MEDICATION);
  const dose = firstHit(message, DOSE);
  if (drug && dose) {
    return { verdict: 'reject_medical', reason: 'medication', matched: `${drug} + ${dose}` };
  }

  const extreme = firstHit(message, EXTREME_DIET);
  if (extreme) return { verdict: 'reject_extreme', reason: 'extreme_diet', matched: extreme };

  const nonTarget = firstHit(message, NON_TARGET) ?? message.match(NON_TARGET_AGE)?.[0] ?? null;
  if (nonTarget) return { verdict: 'non_target_user', reason: 'non_target', matched: nonTarget };

  return null;
}