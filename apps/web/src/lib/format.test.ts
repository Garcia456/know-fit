import { describe, expect, it } from 'vitest';
import { formatCitationTs, formatDeltaPct, formatKg, formatMmSs } from './format';

describe('formatMmSs', () => {
  it('格式化常见秒数', () => {
    expect(formatMmSs(0)).toBe('0:00');
    expect(formatMmSs(59)).toBe('0:59');
    expect(formatMmSs(61)).toBe('1:01');
    expect(formatMmSs(3599)).toBe('59:59');
  });

  it('无效值降级为破折号，不编造时间', () => {
    expect(formatMmSs(null)).toBe('—');
    expect(formatMmSs(undefined)).toBe('—');
    expect(formatMmSs(-1)).toBe('—');
    expect(formatMmSs(Number.NaN)).toBe('—');
  });
});

describe('formatCitationTs', () => {
  it('不足 1 秒不显示时间点', () => {
    expect(formatCitationTs(0)).toBeNull();
    expect(formatCitationTs(0.4)).toBeNull();
    expect(formatCitationTs(0.999)).toBeNull();
    expect(formatCitationTs(null)).toBeNull();
  });

  it('满 1 秒起才格式化', () => {
    expect(formatCitationTs(1)).toBe('0:01');
    expect(formatCitationTs(61.8)).toBe('1:01');
  });
});

describe('训练量格式', () => {
  it('kg 最多一位小数', () => {
    expect(formatKg(3600)).toBe('3,600 kg');
    expect(formatKg(12.34)).toBe('12.3 kg');
  });

  it('环比带符号', () => {
    expect(formatDeltaPct(12.5)).toBe('+12.5%');
    expect(formatDeltaPct(-3)).toBe('-3%');
  });
});