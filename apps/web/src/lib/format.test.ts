import { describe, expect, it } from 'vitest';
import { formatDeltaPct, formatKg, formatMmSs } from './format';

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