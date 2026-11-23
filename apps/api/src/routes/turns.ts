import type { FastifyInstance } from 'fastify';
import { TurnRequestSchema, type TurnResponse } from '../contracts/turn.js';
import { LlmConfigError, llmConfigErrorResponse } from '../llm/errors.js';
import { ConversationNotFoundError } from '../services/conversation.js';
import { DeadlineExceededError } from '../services/assessment.js';
import { resolveLlmForUser } from '../services/llm-config.js';
import { consumeTurn } from '../services/quota.js';
import { handleTurn } from '../services/turn.js';

/**
 * `POST /turns` —— 一轮对话录入。
 *
 * ⚠️ 对外路径是 `/api/turns`：vite dev server 把 `/api` 前缀重写掉后才到 API
 *    （与 `/api/health` → `/health` 同一个约定）。
 *
 * 🔴 本文件在路由层 —— **不许 import `../db/schema.js`**，一律经服务层取裁剪过的字段。
 */
export async function turnRoutes(app: FastifyInstance): Promise<void> {
  app.post('/turns', async (request, reply): Promise<TurnResponse | undefined> => {
    const parsed = TurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: '请求体需要 { message: string, conversation_id?: string }' });
      return undefined;
    }

    try {
      // 先解析模型：自带 Key 的用户不扣额度；Key 本身有问题时也不算用掉一次
      const { llm, byo } = await resolveLlmForUser(request.userId);

      if (!byo) {
        // 资格闸门在入口：合法请求先扣 1 次；扣不到就按原因拒绝。
        const quota = await consumeTurn(request.userId);
        if (quota === 'email_unverified') {
          await reply.code(403).send({
            error: '邮箱还没验证 —— 验证后可领取免费对话次数，设置页可以重新发送验证邮件',
            code: 'email_unverified',
          });
          return undefined;
        }
        if (quota === 'quota_exhausted') {
          await reply.code(402).send({
            error: '免费对话次数用完了 —— 在设置页填入自己的 API Key 后可继续',
            code: 'free_quota_exhausted',
          });
          return undefined;
        }
      }

      return await handleTurn(
        {
          message: parsed.data.message,
          user_id: request.userId,
          conversation_id: parsed.data.conversation_id ?? null,
        },
        { llm },
      );
    } catch (e) {
      if (e instanceof LlmConfigError) {
        const mapped = llmConfigErrorResponse(e);
        await reply.code(mapped.status).send(mapped.body);
        return undefined;
      }
      if (e instanceof ConversationNotFoundError) {
        await reply.code(404).send({ error: '会话不存在' });
        return undefined;
      }
      if (e instanceof DeadlineExceededError) {
        await reply.code(504).send({ error: '这次回答超时了 —— 再发一次试试' });
        return undefined;
      }
      throw e;
    }
  });
}
