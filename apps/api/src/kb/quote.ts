/**
 * 对外短引用 —— **确定性摘原话，逐字来自 `text`**。
 *
 * 🔴 它不是摘要：不做概括、不改写、不补主语。
 *    选句规则只回答「哪一段原话最像话」，不回答「这段讲了什么」。
 * 规则：
 *   ① 按句末标点切句，**不取片首的碎句**（ASR 片首常是「它就是感受强」这种单独看没信息量的话）；
 *   ② 在够长的句子里取**最长**的那句（并列取靠前的）；
 *   ③ 一句都没有标点 → 取末尾一段（仍是原文字符串，不是生成物）。
 */

/** 短于此字数的句子不进候选 —— 避免摘出「并且受力会更好」这种半句 */
const MIN_QUOTE_CHARS = 12;
/** 无标点时的兜底截取长度 */
const FALLBACK_CHARS = 40;

export function splitSentences(text: string): string[] {
  return (text.match(/[^。！？!?；;…]+[。！？!?；;…]?/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

export function extractShortQuote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!/[。！？!?；;…]/.test(trimmed)) {
    return trimmed.length <= FALLBACK_CHARS ? trimmed : trimmed.slice(-FALLBACK_CHARS).trim();
  }

  const candidates = splitSentences(trimmed).filter((s) => s.length >= MIN_QUOTE_CHARS);
  if (candidates.length > 0) {
    // 最长优先；同长取靠前的（`reduce` 只在严格更长时替换）
    return candidates.reduce((best, s) => (s.length > best.length ? s : best));
  }

  if (trimmed.length <= FALLBACK_CHARS) return trimmed;
  return trimmed.slice(-FALLBACK_CHARS).trim();
}

/** 引用必须是原文的**连续子串** —— 真跑时用它断言，防止哪天悄悄掺进概括 */
export function isVerbatimQuote(quote: string, text: string): boolean {
  return quote.length > 0 && text.includes(quote);
}