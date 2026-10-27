import type { FastifyInstance } from 'fastify';
import { ProfileInputSchema, type Profile } from '../contracts/sessions.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { getProfile, saveProfile } from '../services/profile.js';

/** `/api/profile` —— 读与写。留空（null）是合法值。 */
export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/profile', async (): Promise<Profile> => getProfile(SINGLE_USER_ID));

  app.put('/profile', async (request, reply): Promise<Profile | undefined> => {
    const parsed = ProfileInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({
        error: '身高 100–250、体重 30–300，目标与训练年限取值见契约；未填请传 null',
      });
      return undefined;
    }
    return saveProfile({ user_id: SINGLE_USER_ID, profile: parsed.data });
  });
}