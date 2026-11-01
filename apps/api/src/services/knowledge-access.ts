import { eq } from 'drizzle-orm';
import { knowledgeAccess } from '../db/schema.js';
import { visiblePlatforms } from '../kb/platforms.js';
import { getDb } from './pool.js';

/** 该用户实际可检索的平台。无授权行 = 空数组。 */
export async function visiblePlatformsFor(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ platform: knowledgeAccess.platform })
    .from(knowledgeAccess)
    .where(eq(knowledgeAccess.userId, userId));
  return visiblePlatforms(rows.map((r) => r.platform));
}