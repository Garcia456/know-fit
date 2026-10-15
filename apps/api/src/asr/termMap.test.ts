import { describe, expect, it } from 'vitest';
import { correctTerms, correctTranscript, TERM_FIXES } from './termMap.js';

/**
 * 同音纠错表 —— 纯字符串映射，不碰库、不碰模型。
 *
 * 🔴 这组测试守的是**两条相反的方向**：
 *    「错形必被改」（不然表白写）和「正形与表外文本一个字符都不动」（不然是新的脏数据源）。
 *    后者更要紧 —— 把说对的话改错，比不改还坏。
 */

describe('correctTerms：错形必被改', () => {
  it('改回正形，且一次全改（同一段里出现多次）', () => {
    expect(correctTerms('练保加利亚敦的人越来越多，保加利亚敦长期只蹲到一半')).toBe(
      '练保加利亚蹲的人越来越多，保加利亚蹲长期只蹲到一半',
    );
  });

  it('国生肌 → 腘绳肌', () => {
    expect(correctTerms('强化臀肌国生肌')).toBe('强化臀肌腘绳肌');
  });

  it('高维下拉 → 高位下拉', () => {
    expect(correctTerms('高维下拉半程')).toBe('高位下拉半程');
  });
});

describe('correctTerms：表外文本一个字符都不动', () => {
  it('正形原样留着 —— 不能把对的改错', () => {
    expect(correctTerms('保加利亚蹲、腘绳肌、高位下拉')).toBe('保加利亚蹲、腘绳肌、高位下拉');
  });

  it('同一个字出现在别的词里也不动 —— 「敦」不是「蹲」', () => {
    expect(correctTerms('伦敦、敦煌、敦厚')).toBe('伦敦、敦煌、敦厚');
  });

  it('长得像但合法的词不动 —— 「占据」是正常词，不是「站距」', () => {
    expect(correctTerms('背阔肌处于一个占据主导位置的状态')).toBe(
      '背阔肌处于一个占据主导位置的状态',
    );
  });

  it('没命中的整句原样返回', () => {
    const s = '肩胛骨下沉的能力不够，背阔肌就发不上力。';
    expect(correctTerms(s)).toBe(s);
  });
});

describe('表本身的不变量', () => {
  it('🔴 错形之间不许互相嵌套 —— 嵌套会让长的被短的切掉一半，留下半截改不回来', () => {
    for (const a of TERM_FIXES) {
      for (const b of TERM_FIXES) {
        if (a.wrong === b.wrong) continue;
        expect(a.wrong.includes(b.wrong)).toBe(false);
      }
    }
  });

  it('🔴 正形里不许再含别的错形 —— 否则先改出来的正形会被下一轮再改一次', () => {
    for (const a of TERM_FIXES) {
      for (const b of TERM_FIXES) {
        expect(a.right.includes(b.wrong)).toBe(false);
      }
    }
  });

  it('错形与正形不能相同（写反了等于没改）', () => {
    for (const { wrong, right } of TERM_FIXES) expect(wrong).not.toBe(right);
  });
});

describe('correctTranscript：整条转写逐段过表', () => {
  it('只动命中段的文本，时间戳与把握度原样', () => {
    const out = correctTranscript({
      language: 'zh',
      segments: [
        { start_ts: 0, end_ts: 2.24, text: '练保加利亚敦的人越来越多', confidence: 0.94 },
        { start_ts: 2.24, end_ts: 3.92, text: '但下面三点做不到位', confidence: 0.91 },
      ],
    });
    expect(out.segments.map((s) => s.text)).toEqual([
      '练保加利亚蹲的人越来越多',
      '但下面三点做不到位',
    ]);
    expect(out.segments[0]).toMatchObject({ start_ts: 0, end_ts: 2.24, confidence: 0.94 });
    expect(out.language).toBe('zh');
  });
});