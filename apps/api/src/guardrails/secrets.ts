/**
 * 响应防漏（密钥）：出站 JSON 里出现 OpenAI 风格明文 Key 就抹掉。
 *
 * 兜底而非主防线 —— 主防线是「Key 只进请求、库里只存密文、错误文案不带上游 body」。
 * 这里只认 `sk-` 前缀的长串；短串不是 Key，不动。
 */

const SECRET_PATTERN = /sk-[A-Za-z0-9_-]{20,}/g;

export interface ScrubResult {
  payload: string;
  redacted: number;
}

/** 返回抹过的载荷与命中次数 —— 调用方只记次数，不记原文。 */
export function scrubSecrets(payload: string): ScrubResult {
  let redacted = 0;
  const scrubbed = payload.replace(SECRET_PATTERN, () => {
    redacted += 1;
    return 'sk-***';
  });
  return { payload: scrubbed, redacted };
}
