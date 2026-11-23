import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { SecretBoxError, openSecret, sealSecret } from './secret-box.js';

/** 加密只测三件事：能还原、密文不带明文、改一位就失败。 */

const saved = process.env.KEY_ENCRYPTION_SECRET;

afterEach(() => {
  if (saved === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
  else process.env.KEY_ENCRYPTION_SECRET = saved;
});

describe('Key 静态加密', () => {
  it('加密后可原样解回，密文不含明文', () => {
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString('base64');
    const plain = 'sk-1234567890abcdef1234567890abcdef';

    const sealed = sealSecret(plain);

    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain(plain);
    expect(openSecret(sealed)).toBe(plain);
  });

  it('同一明文两次加密密文不同（IV 随机）', () => {
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString('base64');
    expect(sealSecret('sk-same')).not.toBe(sealSecret('sk-same'));
  });

  it('密文被改一位就解不开', () => {
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString('base64');
    const sealed = sealSecret('sk-tamper');
    const last = sealed.at(-1) === 'A' ? 'B' : 'A';
    const tampered = `${sealed.slice(0, -1)}${last}`;

    expect(() => openSecret(tampered)).toThrow(SecretBoxError);
  });

  it('换一把 KEK 解不开', () => {
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString('base64');
    const sealed = sealSecret('sk-wrong-key');
    process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString('base64');

    expect(() => openSecret(sealed)).toThrow(SecretBoxError);
  });

  it('没配或配错 KEK 时明确报错', () => {
    delete process.env.KEY_ENCRYPTION_SECRET;
    expect(() => sealSecret('sk-x')).toThrow(/KEY_ENCRYPTION_SECRET/);

    process.env.KEY_ENCRYPTION_SECRET = 'too-short';
    expect(() => sealSecret('sk-x')).toThrow(/32 字节/);
  });
});
