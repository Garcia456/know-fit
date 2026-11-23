import { eq } from 'drizzle-orm';
import type { AiKeySummary } from '../contracts/auth.js';
import { user, userLlmConfig } from '../db/schema.js';
import type { ChatRequest, LlmCallOptions, LlmClient, StructuredRequest } from '../llm/client.js';
import { LlmConfigError } from '../llm/errors.js';
import { createLlmClient } from '../llm/index.js';
import { createOpenAiClient } from '../llm/openai.js';
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODELS, isDeepSeekModel } from '../llm/providers.js';
import { SecretBoxError, openSecret, sealSecret } from '../security/secret-box.js';
import { getDb } from './pool.js';
import { FREE_TURNS_LIMIT } from './quota.js';

/**
 * 每个请求解析一次模型客户端：
 *   有自带配置 → 解密 Key，走固定 DeepSeek 端点（不扣额度）
 *   没有       → 服务端客户端（资格闸门照常）
 *
 * 🔴 绝不进程级缓存 —— 缓存一次就会把某个用户的 Key 冻结给所有人。
 */

export interface ResolvedLlm {
  llm: LlmClient;
  /** true = 用的是用户自己的 Key，不消耗免费额度 */
  byo: boolean;
}

export async function resolveLlmForUser(userId: string): Promise<ResolvedLlm> {
  const rows = await getDb()
    .select({
      model: userLlmConfig.model,
      keyCiphertext: userLlmConfig.keyCiphertext,
    })
    .from(userLlmConfig)
    .where(eq(userLlmConfig.userId, userId));
  const row = rows[0];
  if (!row) return { llm: createLlmClient(), byo: false };

  let apiKey: string;
  try {
    apiKey = openSecret(row.keyCiphertext);
  } catch (e) {
    if (e instanceof SecretBoxError) throw new LlmConfigError('key_unreadable');
    throw e;
  }

  // 白名单可能在保存之后收窄过；对不上就让人回设置里重选，而不是拿旧模型打上游
  if (!isDeepSeekModel(row.model)) throw new LlmConfigError('model_unknown');

  const client = createOpenAiClient({
    apiKey,
    baseUrl: DEEPSEEK_BASE_URL,
    model: row.model,
    method: 'jsonMode',
    profile: 'deepseek',
  });
  return { llm: withUpstreamErrors(client), byo: true };
}

/** 上游 401/403 → Key 无效；429 → 限流。其余原样抛出，由调用方按生成失败处理。 */
function withUpstreamErrors(client: LlmClient): LlmClient {
  return {
    model: client.model,
    async structured<T extends Record<string, unknown>>(
      req: StructuredRequest<T>,
      options?: LlmCallOptions,
    ): Promise<T> {
      try {
        return await client.structured(req, options);
      } catch (e) {
        throw mapUpstreamError(e);
      }
    },
    async generate(req: ChatRequest, options?: LlmCallOptions): Promise<string> {
      try {
        return await client.generate(req, options);
      } catch (e) {
        throw mapUpstreamError(e);
      }
    },
  };
}

function mapUpstreamError(error: unknown): unknown {
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return new LlmConfigError('key_invalid');
  if (status === 429) return new LlmConfigError('rate_limited');
  return error;
}

/* ---------- 设置页：资格 / 额度 / Key 状态 ---------- */

export interface AccountAiView {
  email_verified: boolean;
  invite_unlocked: boolean;
  quota: { used: number; limit: number; remaining: number };
  key: AiKeySummary | null;
  models: string[];
}

export async function readAccountAi(userId: string): Promise<AccountAiView> {
  const [row] = await getDb()
    .select({
      emailVerifiedAt: user.emailVerifiedAt,
      inviteUnlockedAt: user.inviteUnlockedAt,
      freeTurnsUsed: user.freeTurnsUsed,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) throw new Error('用户不存在');

  const [config] = await getDb()
    .select({
      model: userLlmConfig.model,
      keyHint: userLlmConfig.keyHint,
      updatedAt: userLlmConfig.updatedAt,
    })
    .from(userLlmConfig)
    .where(eq(userLlmConfig.userId, userId));

  return {
    email_verified: row.emailVerifiedAt !== null,
    invite_unlocked: row.inviteUnlockedAt !== null,
    quota: {
      used: row.freeTurnsUsed,
      limit: FREE_TURNS_LIMIT,
      remaining: Math.max(FREE_TURNS_LIMIT - row.freeTurnsUsed, 0),
    },
    key: config
      ? {
          configured: true,
          model: config.model,
          hint: config.keyHint,
          updated_at: config.updatedAt.toISOString(),
        }
      : null,
    models: [...DEEPSEEK_MODELS],
  };
}

/** 探测没打通但不是 Key 本身的问题（网络 / 上游 5xx）—— 路由按 502 处理 */
export class KeyProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyProbeError';
  }
}

export const KEY_PROBE_TIMEOUT_MS = 8_000;

/** 用固定端点发一次最小请求：只验 Key 与模型可用，上游 body 一律不带回来。 */
export async function probeDeepSeekKey(input: { api_key: string; model: string }): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.api_key}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(KEY_PROBE_TIMEOUT_MS),
    });
  } catch {
    throw new KeyProbeError('探测请求没发出去');
  }

  // 不读 body：响应内容与我们无关，读它只会把上游报错带进内存 / 日志
  try {
    await res.body?.cancel();
  } catch {
    // 取消失败不影响判定
  }

  if (res.ok) return;
  if (res.status === 401 || res.status === 403) throw new LlmConfigError('key_invalid');
  if (res.status === 429) throw new LlmConfigError('rate_limited');
  if (res.status === 400 || res.status === 404) throw new LlmConfigError('model_unknown');
  throw new KeyProbeError(`上游返回 ${res.status}`);
}

export interface SaveLlmKeyDeps {
  /** 测试注入用；默认打固定 DeepSeek 端点 */
  probe?: (input: { api_key: string; model: string }) => Promise<void>;
}

/** 探测通过才落库；任何失败都不写 —— 不会有「半把 Key」 */
export async function saveUserLlmKey(
  userId: string,
  input: { api_key: string; model: string },
  deps: SaveLlmKeyDeps = {},
): Promise<AiKeySummary> {
  if (!isDeepSeekModel(input.model)) throw new LlmConfigError('model_unknown');

  // 先加密：KEK 缺失时直接报 503，不白打一次探测请求
  let keyCiphertext: string;
  try {
    keyCiphertext = sealSecret(input.api_key);
  } catch (e) {
    if (e instanceof SecretBoxError) throw new LlmConfigError('key_missing');
    throw e;
  }

  await (deps.probe ?? probeDeepSeekKey)(input);

  const keyHint = input.api_key.slice(-4);
  const [row] = await getDb()
    .insert(userLlmConfig)
    .values({
      userId,
      provider: 'deepseek',
      model: input.model,
      keyCiphertext,
      keyHint,
    })
    .onConflictDoUpdate({
      target: userLlmConfig.userId,
      set: {
        model: input.model,
        keyCiphertext,
        keyHint,
        updatedAt: new Date(),
      },
    })
    .returning({
      model: userLlmConfig.model,
      keyHint: userLlmConfig.keyHint,
      updatedAt: userLlmConfig.updatedAt,
    });
  if (!row) throw new Error('保存 Key 没有返回行');

  return {
    configured: true,
    model: row.model,
    hint: row.keyHint,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function deleteUserLlmKey(userId: string): Promise<void> {
  await getDb().delete(userLlmConfig).where(eq(userLlmConfig.userId, userId));
}
