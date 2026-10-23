import { describe, expect, it } from 'vitest';
import { extractShortQuote, isVerbatimQuote, splitSentences } from './quote.js';

describe('splitSentences', () => {
  it('按句末标点切句，并保留标点', () => {
    expect(splitSentences('第一句。第二句！第三句？')).toEqual(['第一句。', '第二句！', '第三句？']);
  });
});

describe('extractShortQuote', () => {
  it('取够长句子里最长的一句', () => {
    const text = '它就是感受强。所以上斜哑铃卧推要先把肩胛骨收住。嗯。';
    expect(extractShortQuote(text)).toBe('所以上斜哑铃卧推要先把肩胛骨收住。');
  });

  it('片首碎句不进候选', () => {
    const text = '但是呢。真正重要的是离心阶段要控制三秒钟。';
    expect(extractShortQuote(text)).toBe('真正重要的是离心阶段要控制三秒钟。');
  });

  it('引用的每一个字都来自原文（连续子串）', () => {
    const text = '如果你想练上胸，就把凳子调到三十度。';
    const quote = extractShortQuote(text);
    expect(isVerbatimQuote(quote, text)).toBe(true);
  });

  it('一句标点都没有 → 取末尾 40 字，仍是原文', () => {
    const text = '啊'.repeat(60) + '最后这句话没有句号';
    const quote = extractShortQuote(text);
    expect(quote).toHaveLength(40);
    expect(isVerbatimQuote(quote, text)).toBe(true);
  });

  it('短文本原样返回；空文本返回空串', () => {
    expect(extractShortQuote('短句')).toBe('短句');
    expect(extractShortQuote('   ')).toBe('');
  });
});