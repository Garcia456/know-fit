import { describe, expect, it } from 'vitest';
import { checkInviteCode } from './invite-code.js';

describe('checkInviteCode', () => {
  it('没配 KNOWLEDGE_INVITE_CODE → 功能未开放', () => {
    const verdict = checkInviteCode('anything', {});
    expect(verdict).toMatchObject({ ok: false, code: 'not_configured' });
  });

  it('配置了邀请码：对得上才放行', () => {
    const env = { KNOWLEDGE_INVITE_CODE: 'knowfit-invite' };
    expect(checkInviteCode('knowfit-invite', env).ok).toBe(true);
    expect(checkInviteCode('  knowfit-invite  ', env).ok).toBe(true);
    expect(checkInviteCode('wrong', env)).toMatchObject({ ok: false, code: 'wrong' });
  });

  it('空邀请码不当成「未配置」', () => {
    const env = { KNOWLEDGE_INVITE_CODE: 'knowfit-invite' };
    expect(checkInviteCode('   ', env)).toMatchObject({ ok: false, code: 'wrong' });
  });

  it('配置值只有空白 → 仍视为未开放', () => {
    expect(checkInviteCode('anything', { KNOWLEDGE_INVITE_CODE: '   ' })).toMatchObject({
      ok: false,
      code: 'not_configured',
    });
  });
});
