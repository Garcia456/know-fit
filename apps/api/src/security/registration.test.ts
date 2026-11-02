import { describe, expect, it } from 'vitest';
import { checkRegistration } from './registration.js';

describe('注册闸门', () => {
  it('本地没配邀请码 → 保持开放', () => {
    expect(checkRegistration(undefined, {}).ok).toBe(true);
  });

  it('生产没配邀请码 → 关闭注册', () => {
    const verdict = checkRegistration(undefined, { NODE_ENV: 'production' });
    expect(verdict).toEqual({ ok: false, error: '注册未开放' });
  });

  it('配了邀请码：对得上才放行', () => {
    const env = { REGISTRATION_INVITE_CODE: 'knowfit-invite' };
    expect(checkRegistration('knowfit-invite', env).ok).toBe(true);
    expect(checkRegistration('  knowfit-invite  ', env).ok).toBe(true);
    expect(checkRegistration('wrong', env)).toEqual({ ok: false, error: '邀请码不对' });
  });

  it('配了邀请码但没带 → 拒绝', () => {
    const env = { REGISTRATION_INVITE_CODE: 'knowfit-invite' };
    expect(checkRegistration(undefined, env)).toEqual({ ok: false, error: '需要邀请码' });
    expect(checkRegistration('   ', env)).toEqual({ ok: false, error: '需要邀请码' });
  });

  it('生产配了邀请码时，空邀请码不当成「未配置」', () => {
    const env = { NODE_ENV: 'production', REGISTRATION_INVITE_CODE: '   ' };
    expect(checkRegistration('anything', env).ok).toBe(false);
  });
});