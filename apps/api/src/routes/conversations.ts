import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ConversationNotFoundError,
  deleteConversation,
  getConversation,
  listConversations,
  normalizeTitle,
  renameConversation,
} from '../services/conversation.js';

/**
 * 会话列表 / 恢复 / 重命名 / 删除。
 * 🔴 删除只删会话与消息，不动训练记录。
 */

const RenameSchema = z.object({ title: z.string() });

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/conversations', async (request) => {
    return { conversations: await listConversations(request.userId) };
  });

  app.get('/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) {
      await reply.code(400).send({ error: '会话 id 不是合法 UUID' });
      return undefined;
    }
    try {
      return await getConversation(request.userId, id);
    } catch (e) {
      if (e instanceof ConversationNotFoundError) {
        await reply.code(404).send({ error: '会话不存在' });
        return undefined;
      }
      throw e;
    }
  });

  app.patch('/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) {
      await reply.code(400).send({ error: '会话 id 不是合法 UUID' });
      return undefined;
    }
    const parsed = RenameSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: '请求体需要 { title: string }' });
      return undefined;
    }
    const title = normalizeTitle(parsed.data.title);
    if (!title) {
      await reply.code(400).send({ error: '标题需要 1–40 字' });
      return undefined;
    }
    try {
      return { conversation: await renameConversation({ user_id: request.userId, conversation_id: id, title }) };
    } catch (e) {
      if (e instanceof ConversationNotFoundError) {
        await reply.code(404).send({ error: '会话不存在' });
        return undefined;
      }
      throw e;
    }
  });

  app.delete('/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) {
      await reply.code(400).send({ error: '会话 id 不是合法 UUID' });
      return undefined;
    }
    try {
      await deleteConversation(request.userId, id);
      await reply.code(204).send();
    } catch (e) {
      if (e instanceof ConversationNotFoundError) {
        await reply.code(404).send({ error: '会话不存在' });
        return undefined;
      }
      throw e;
    }
    return undefined;
  });
}