import { describe, expect, it } from 'vitest';
import { checkGuard } from './guard.js';

/**
 * 红线规则表 —— 两个方向都要测：
 * **漏拦**（真红线没拦住）与**误拦**（正常训练被拦）是两种不同的失败。
 */

describe('正例：真红线必须被拦住', () => {
  it('伤病 / 疼痛 → reject_medical（medical）', () => {
    expect(checkGuard('深蹲膝盖疼怎么办')).toMatchObject({
      verdict: 'reject_medical',
      reason: 'medical',
      matched: '疼',
    });
  });

  it('「腰突能练吗」也走伤病出口', () => {
    expect(checkGuard('腰突能练吗')?.reason).toBe('medical');
  });

  it('用药 / 补剂剂量 → reject_medical（medication）', () => {
    expect(checkGuard('肌酸该吃多少')).toMatchObject({
      verdict: 'reject_medical',
      reason: 'medication',
    });
  });

  it('极端饮食 → reject_extreme', () => {
    expect(checkGuard('怎么一周瘦十斤')).toMatchObject({
      verdict: 'reject_extreme',
      reason: 'extreme_diet',
    });
    expect(checkGuard('催吐有用吗')?.verdict).toBe('reject_extreme');
  });

  it('非目标人群 → non_target_user（14 岁）', () => {
    expect(checkGuard('我 14 岁，能练吗')).toMatchObject({ verdict: 'non_target_user' });
  });

  it('优先级：伤病先于非目标人群', () => {
    expect(checkGuard('我 14 岁，膝盖疼')).toMatchObject({ reason: 'medical' });
  });
});

describe('负例：正常训练不许被误拦', () => {
  const normal = [
    '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组',
    '昨天练了胸',
    '今天练得挺爽，肌肉有点酸胀',
    '硬拉 100kg 五组三次',
    '深蹲 100kg 五组',
    '保加利亚分腿蹲 20kg 三组',
    '中午吃了两碗米饭',
    '今天该吃多少饭', // 有「吃多少」但没有药/补剂词 —— 不许被当成用药
    '40 岁还能练吗', // 年龄模式只认 6–17 岁
    '练完心跳有点快', // 「心脏」只在「心脏病」里命中
    '深蹲练到极限了', // 「极限」不是极端饮食
  ];

  for (const message of normal) {
    it(`「${message}」→ 通过`, () => {
      expect(checkGuard(message)).toBeNull();
    });
  }
});