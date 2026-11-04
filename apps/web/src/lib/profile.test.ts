import { describe, expect, it } from 'vitest';
import { formatTraining, parseProfileForm, toFormValues, totalTrainingMonths } from './profile';

describe('parseProfileForm', () => {
  it('留空全部保存为 null', () => {
    const result = parseProfileForm({ height: '', weight: '  ', goal: null, frequency: null, years: null, months: null });
    expect(result).toEqual({
      ok: true,
      input: { height_cm: null, weight_kg: null, goal: null, training_frequency: null, training_years: null, training_months: null },
    });
  });

  it('合法值转数字', () => {
    const result = parseProfileForm({
      height: '180',
      weight: '75.5',
      goal: '增肌+减脂',
      frequency: '三分化',
      years: 2,
      months: 3,
    });
    expect(result.ok && result.input).toMatchObject({
      height_cm: 180,
      weight_kg: 75.5,
      goal: '增肌+减脂',
      training_frequency: '三分化',
      training_years: 2,
      training_months: 3,
    });
  });

  it('越界报错且不提交', () => {
    const result = parseProfileForm({ height: '99', weight: '301', goal: null, frequency: null, years: null, months: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.height).toContain('100');
      expect(result.errors.weight).toContain('300');
    }
  });

  it('非数字报错', () => {
    const result = parseProfileForm({ height: 'abc', weight: '', goal: null, frequency: null, years: null, months: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.height).toContain('数字');
  });
});

describe('toFormValues', () => {
  it('null 显示为空串', () => {
    expect(
      toFormValues({
        height_cm: null,
        weight_kg: null,
        goal: null,
        training_frequency: null,
        training_years: null,
        training_months: null,
      }),
    ).toEqual({ height: '', weight: '', goal: null, frequency: null, years: null, months: null });
  });
});

describe('训练年限显示', () => {
  it('按年 / 月拼，0 的单位省略', () => {
    expect(formatTraining(2, 3)).toBe('2 年 3 个月');
    expect(formatTraining(2, 0)).toBe('2 年');
    expect(formatTraining(0, 5)).toBe('5 个月');
    expect(formatTraining(0, 0)).toBe('不足 1 个月');
    expect(formatTraining(null, null)).toBe('未填');
  });

  it('总月数给边界判定用', () => {
    expect(totalTrainingMonths(2, 3)).toBe(27);
    expect(totalTrainingMonths(0, 2)).toBe(2);
    expect(totalTrainingMonths(null, null)).toBeNull();
  });
});