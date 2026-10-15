import type { Transcript } from '../kb/types.js';

/**
 * 同音纠错表 —— ASR 听错的健身术语，按「错形 → 正形」确定性改回。
 *
 * 加词的门槛两条都要满足，缺一条就不收：
 *   ① **错形不是任何一个合法的词** —— 否则会在别的语境里改坏正常文本。
 *      反例：「占据」是正常的词，某个候选模型把它当过「站距」写出来，
 *      收进表里就会把「占据主导位置」改烂；
 *   ② **正形能在自有资产里锚定**（`seed/exercises.json` 的动作名等），不是凭印象补的。
 *
 * 宁可漏一个，不改错一个：**表以外的文本一个字符都不动**。
 * 表里的错形之间**不许互相嵌套**（见 `termMap.test.ts` 的不变量）。
 */

export interface TermFix {
  /** ASR 吐出来的错形 */
  wrong: string;
  /** 改回的正形 */
  right: string;
}

export const TERM_FIXES: readonly TermFix[] = [
  { wrong: '保加利亚敦', right: '保加利亚蹲' },
  { wrong: '国生肌', right: '腘绳肌' },
  { wrong: '高维下拉', right: '高位下拉' },
];

/** 一段文本过一遍表 —— 命中就换，没命中就原样返回 */
export function correctTerms(text: string): string {
  let out = text;
  for (const { wrong, right } of TERM_FIXES) {
    if (out.includes(wrong)) out = out.split(wrong).join(right);
  }
  return out;
}

/** 整条转写逐段过表 —— 只动文本，时间戳与把握度原样保留 */
export function correctTranscript(transcript: Transcript): Transcript {
  return {
    language: transcript.language,
    segments: transcript.segments.map((s) => ({ ...s, text: correctTerms(s.text) })),
  };
}