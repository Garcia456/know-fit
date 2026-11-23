import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { userLlmConfig } from '../db/schema.js';
import { LlmConfigError } from '../llm/errors.js';
import { DEEPSEEK_MODELS } from '../llm/providers.js';
import { sealSecret } from '../security/secret-box.js';
import {
  deleteUserLlmKey,
  readAccountAi,
  resolveLlmForUser,
  saveUserLlmKey,
} from './llm-config.js';
import { closeDb, getDb, getPool } from './pool.js';
import { FREE_TURNS_LIMIT } from './quota.js';
import { registerForTest } from './register-for-test.js';

/**
 * 按用户解析模型 —— 连真库。
 * 关键断言：没配置走服务端；有配置只解密不联网；坏密文 / 白名单外模型明确报配置错。
 */

const PREFIX = 'test-llm-config-';
const savedSecret = process.env.KEY_ENCRYPTION_SECRET;
const ids: string[] = [];

async function createUser(): Promise<string> {
  const result = await registerForTest({
    email: `${PREFIX}${randomUUID()}@knowfit.local`,
    password: 'knowfit-test-123',
    nickname: '自带Key测试',
  });
  ids.push(result.user.id);
  return result.user.id;
}

async function saveConfig(
  userId: string,
  input: { model: string; keyCiphertext: string },
): Promise<void> {
  await getDb().insert(userLlmConfig).values({
    userId,
    provider: 'deepseek',
    model: input.model,
    keyCiphertext: input.keyCiphertext,
    keyHint: 'wxyz',
  });
}

beforeAll(() => {
  process.env.KEY_ENCRYPTION_SECRET = randomBytes(32).toString('base64');
});

afterAll(async () => {
  await getPool().query('DELETE FROM registration_verification WHERE email LIKE $1', [`${PREFIX}%`]);
  if (ids.length > 0) {
    await getPool().query('DELETE FROM "user" WHERE id = ANY($1)', [ids]);
  }
  if (savedSecret === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
  else process.env.KEY_ENCRYPTION_SECRET = savedSecret;
  await closeDb();
});

describe('按用户解析模型', () => {
  it('没有配置 → 走服务端客户端，不扣额度', async () => {
    const userId = await createUser();
    const resolved = await resolveLlmForUser(userId);

    expect(resolved.byo).toBe(false);
  });

  it('有配置 → 解密出自己的客户端，模型来自配置', async () => {
    const userId = await createUser();
    const model = DEEPSEEK_MODELS[0]!;
    await saveConfig(userId, { model, keyCiphertext: sealSecret('sk-user-key-1234') });

    const resolved = await resolveLlmForUser(userId);

    expect(resolved.byo).toBe(true);
    expect(resolved.llm.model).toBe(model);
  });

  it('密文解不开 → key_unreadable', async () => {
    const userId = await createUser();
    await saveConfig(userId, {
      model: DEEPSEEK_MODELS[0]!,
      keyCiphertext: 'v1:AAAA:BBBB:CCCC',
    });

    await expect(resolveLlmForUser(userId)).rejects.toMatchObject({
      code: 'key_unreadable',
    });
  });

  it('模型不在白名单 → model_unknown', async () => {
    const userId = await createUser();
    await saveConfig(userId, { model: 'gpt-4o', keyCiphertext: sealSecret('sk-user-key-5678') });

    const error = await resolveLlmForUser(userId).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmConfigError);
    expect((error as LlmConfigError).code).toBe('model_unknown');
  });

  it('删除配置后回到服务端客户端', async () => {
    const userId = await createUser();
    await saveConfig(userId, {
      model: DEEPSEEK_MODELS[0]!,
      keyCiphertext: sealSecret('sk-user-key-9012'),
    });
    await getDb().delete(userLlmConfig).where(eq(userLlmConfig.userId, userId));

    expect((await resolveLlmForUser(userId)).byo).toBe(false);
  });
});

describe('设置页 Key 管理', () => {
  it('注册即已验证；未解锁 / 无 Key', async () => {
    const userId = await createUser();

    const view = await readAccountAi(userId);

    expect(view.email_verified).toBe(true);
    expect(view.invite_unlocked).toBe(false);
    expect(view.key).toBeNull();
    expect(view.quota).toEqual({ used: 0, limit: FREE_TURNS_LIMIT, remaining: FREE_TURNS_LIMIT });
    expect(view.models).toEqual([...DEEPSEEK_MODELS]);
  });

  it('探测通过才落库：库里只有密文，读回只有末 4 位', async () => {
    const userId = await createUser();
    const model = DEEPSEEK_MODELS[0]!;
    const probe = vi.fn(async () => undefined);

    const saved = await saveUserLlmKey(
      userId,
      { api_key: 'sk-test-user-key-0000wxyz', model },
      { probe },
    );

    expect(probe).toHaveBeenCalledOnce();
    expect(saved).toMatchObject({ configured: true, model, hint: 'wxyz' });

    const rows = await getDb()
      .select({ keyCiphertext: userLlmConfig.keyCiphertext })
      .from(userLlmConfig)
      .where(eq(userLlmConfig.userId, userId));
    expect(rows[0]?.keyCiphertext).not.toContain('sk-test');

    const view = await readAccountAi(userId);
    expect(view.key).toMatchObject({ model, hint: 'wxyz' });
    expect((await resolveLlmForUser(userId)).byo).toBe(true);
  });

  it('模型不在白名单 → 不探测、不落库', async () => {
    const userId = await createUser();
    const probe = vi.fn(async () => undefined);

    await expect(
      saveUserLlmKey(userId, { api_key: 'sk-test-user-key-0000wxyz', model: 'gpt-4o' }, { probe }),
    ).rejects.toMatchObject({ code: 'model_unknown' });

    expect(probe).not.toHaveBeenCalled();
    expect((await readAccountAi(userId)).key).toBeNull();
  });

  it('探测失败 → Key 不保存', async () => {
    const userId = await createUser();
    const probe = vi.fn(async () => {
      throw new LlmConfigError('key_invalid');
    });

    await expect(
      saveUserLlmKey(
        userId,
        { api_key: 'sk-test-user-key-0000wxyz', model: DEEPSEEK_MODELS[0]! },
        { probe },
      ),
    ).rejects.toMatchObject({ code: 'key_invalid' });

    expect((await readAccountAi(userId)).key).toBeNull();
  });

  it('删除 Key 后回到服务端客户端', async () => {
    const userId = await createUser();
    await saveUserLlmKey(
      userId,
      { api_key: 'sk-test-user-key-0000wxyz', model: DEEPSEEK_MODELS[0]! },
      { probe: async () => undefined },
    );

    await deleteUserLlmKey(userId);

    expect((await readAccountAi(userId)).key).toBeNull();
    expect((await resolveLlmForUser(userId)).byo).toBe(false);
  });
});
