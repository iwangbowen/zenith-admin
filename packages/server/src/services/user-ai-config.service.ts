import { eq } from 'drizzle-orm';
import { db } from '../db';
import { userAiConfigs } from '../db/schema';
import { currentUser } from '../lib/context';
import { formatDateTime } from '../lib/datetime';
import type { SaveUserAiConfigInput } from '@zenith/shared';

const MASKED_KEY = '******';

function mapRow(row: typeof userAiConfigs.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey ? `${row.apiKey.slice(0, 4)}...${row.apiKey.slice(-4)}` : null,
    model: row.model,
    isEnabled: row.isEnabled,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function getUserAiConfig() {
  const user = currentUser();
  const [row] = await db.select().from(userAiConfigs).where(eq(userAiConfigs.userId, user.userId));
  if (!row) return null;
  return mapRow(row);
}

export async function saveUserAiConfig(input: SaveUserAiConfigInput) {
  const user = currentUser();
  const [existing] = await db.select().from(userAiConfigs).where(eq(userAiConfigs.userId, user.userId));

  // 如果 apiKey 是脱敏格式，保留原值
  const apiKey =
    input.apiKey && input.apiKey !== MASKED_KEY && !input.apiKey.includes('...')
      ? input.apiKey
      : (existing?.apiKey ?? null);

  if (existing) {
    const [row] = await db
      .update(userAiConfigs)
      .set({
        ...(input.provider !== undefined && { provider: input.provider }),
        ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
        apiKey,
        ...(input.model !== undefined && { model: input.model }),
        ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
      })
      .where(eq(userAiConfigs.userId, user.userId))
      .returning();
    return mapRow(row);
  } else {
    const [row] = await db
      .insert(userAiConfigs)
      .values({
        userId: user.userId,
        provider: input.provider ?? 'openai_compatible',
        baseUrl: input.baseUrl ?? null,
        apiKey,
        model: input.model ?? null,
        isEnabled: input.isEnabled ?? true,
      })
      .returning();
    return mapRow(row);
  }
}

export async function getRawUserAiConfig(userId: number) {
  const [row] = await db.select().from(userAiConfigs).where(eq(userAiConfigs.userId, userId));
  return row ?? null;
}
