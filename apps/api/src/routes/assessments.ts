import type { FastifyInstance } from 'fastify';
import { AssessmentRequestSchema, type AssessmentResponse } from '../contracts/assessment.js';
import { LlmConfigError, llmConfigErrorResponse } from '../llm/errors.js';
import { assessRecord } from '../services/assessment.js';
import { resolveLlmForUser } from '../services/llm-config.js';
import { entitlementFor } from '../services/quota.js';

/**
 * `POST /assessments` —— 评估的两个入口（显式 / 钩子）。
 *
 * 显式：不传 id 就评估最近一次训练；传了就评估那一次。
 * 钩子：必须带 `related_record_id`，10 分钟内重复点击返回同一张卡。
 *
 * 🔴 本文件在路由层 —— **不许 import `../db/schema.js`**，一律经服务层取。
 */
export async function assessmentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/assessments', async (request, reply): Promise<AssessmentResponse | undefined> => {
    const parsed = AssessmentRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: '请求体需要 { related_record_id?: uuid, trigger?: explicit|hook }' });
      return undefined;
    }

    const trigger = parsed.data.trigger;
    const relatedRecordId = parsed.data.related_record_id ?? null;

    if (trigger === 'hook' && !relatedRecordId) {
      await reply.code(400).send({ error: '钩子评估必须带 related_record_id' });
      return undefined;
    }

    try {
      const { llm, byo } = await resolveLlmForUser(request.userId);

      // 评估跟随一轮对话，不再扣额度；但没资格的人也不该白拿模型调用。
      if (!byo) {
        const quota = await entitlementFor(request.userId);
        if (quota === 'email_unverified') {
          await reply.code(403).send({
            error: '邮箱还没验证 —— 验证后才能使用评估',
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

      const result = await assessRecord(
        {
          user_id: request.userId,
          related_record_id: relatedRecordId,
          trigger,
        },
        { llm },
      );

      if (result.lookup_status === 'not_found') {
        await reply.code(404).send({ error: '没有这条训练记录' });
        return undefined;
      }

      return {
        card: result.card,
        notices: result.notices,
        lookup_status: result.lookup_status,
        missing: result.missing,
      };
    } catch (e) {
      if (e instanceof LlmConfigError) {
        const mapped = llmConfigErrorResponse(e);
        await reply.code(mapped.status).send(mapped.body);
        return undefined;
      }
      throw e;
    }
  });
}
