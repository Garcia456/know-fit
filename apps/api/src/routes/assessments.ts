import type { FastifyInstance } from 'fastify';
import { AssessmentRequestSchema, type AssessmentResponse } from '../contracts/assessment.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { assessRecord } from '../services/assessment.js';

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

    const result = await assessRecord({
      user_id: SINGLE_USER_ID,
      related_record_id: relatedRecordId,
      trigger,
    });

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
  });
}
