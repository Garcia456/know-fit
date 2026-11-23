import { describe, expect, it } from 'vitest';
import { scrubSecrets } from './secrets.js';

const LONG_KEY = `sk-${'a1B2c3D4e5'.repeat(3)}`;

describe('响应密钥脱敏', () => {
  it('抹掉 JSON 里的明文 Key，替换后仍是合法 JSON', () => {
    const payload = JSON.stringify({ error: `上游拒绝 ${LONG_KEY}`, ok: true });

    const result = scrubSecrets(payload);

    expect(result.redacted).toBe(1);
    expect(result.payload).not.toContain(LONG_KEY);
    expect(JSON.parse(result.payload)).toEqual({ error: '上游拒绝 sk-***', ok: true });
  });

  it('同一响应里多处出现都抹掉', () => {
    const payload = JSON.stringify({ a: LONG_KEY, b: [LONG_KEY] });

    const result = scrubSecrets(payload);

    expect(result.redacted).toBe(2);
    expect(result.payload).not.toContain('a1B2');
  });

  it('不像 Key 的字符串保持原样', () => {
    const payload = JSON.stringify({ hint: 'abcd', short: 'sk-abc' });

    const result = scrubSecrets(payload);

    expect(result.redacted).toBe(0);
    expect(result.payload).toBe(payload);
  });
});
