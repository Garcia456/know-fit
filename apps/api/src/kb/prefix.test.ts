import { describe, expect, it } from 'vitest';
import { buildContextPrefix, formatTimestamp, tailSentence } from './prefix.js';

const base = {
  creator: '阿杰',
  title: '卧推教学',
  topicDomain: '训练',
  start_ts: 80,
  end_ts: 220,
};

describe('formatTimestamp', () => {
  it('一小时以内是 mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(80)).toBe('01:20');
    expect(formatTimestamp(3599)).toBe('59:59');
  });

  it('超过一小时才带小时位', () => {
    expect(formatTimestamp(3600)).toBe('1:00:00');
    expect(formatTimestamp(3725)).toBe('1:02:05');
  });

  it('负数和秒级小数都不炸', () => {
    expect(formatTimestamp(-3)).toBe('00:00');
    expect(formatTimestamp(80.9)).toBe('01:20');
  });
});

describe('tailSentence', () => {
  it('取最后一句', () => {
    expect(tailSentence('第一句。第二句。今天讲上斜卧推。')).toBe('今天讲上斜卧推。');
  });

  it('末句超长时只取末尾 maxChars 字', () => {
    const tail = tailSentence('啊'.repeat(100), 30);
    expect(tail).toHaveLength(30);
  });

  it('空串返回空串', () => {
    expect(tailSentence('   ')).toBe('');
  });
});

describe('buildContextPrefix', () => {
  it('每片都带元数据（博主 / 标题 / 时间 / 主题）', () => {
    const prefix = buildContextPrefix(base);
    expect(prefix).toBe('[阿杰 · 卧推教学 · 01:20–03:40 · 训练]');
  });

  it('主题缺失时写「未分类」，不写 null', () => {
    const prefix = buildContextPrefix({ ...base, topicDomain: null });
    expect(prefix).toContain('· 未分类]');
    expect(prefix).not.toContain('null');
  });

  it('第一片没有「前文」', () => {
    expect(buildContextPrefix(base)).not.toContain('前文');
  });

  it('第二片起带上一片尾句', () => {
    const prefix = buildContextPrefix({ ...base, previousText: '先说结论。手肘别外展。' });
    expect(prefix).toContain('前文：手肘别外展。');
    // 前缀只补语境，原片文本不在这里拼进来
    expect(prefix.startsWith('[阿杰 · 卧推教学 · 01:20–03:40 · 训练]')).toBe(true);
  });
});