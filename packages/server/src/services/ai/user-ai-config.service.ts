import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { userAiConfigs } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { sealApiKey, unsealApiKey } from './ai-providers.service';
import type { SaveUserAiConfigInput } from '@zenith/shared';

const MASKED_KEY = '******';

function mapRow(row: typeof userAiConfigs.$inferSelect) {
  const plainKey = unsealApiKey(row.apiKey);
  return {
    id: row.id,
    userId: row.userId,
    name: row.name ?? null,
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKey: plainKey ? `${plainKey.slice(0, 4)}...${plainKey.slice(-4)}` : null,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    systemPrompt: row.systemPrompt,
    isEnabled: row.isEnabled,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 获取当前用户所有 AI 配置 */
export async function getUserAiConfigs() {
  const user = currentUser();
  const rows = await db.select().from(userAiConfigs).where(eq(userAiConfigs.userId, user.userId));
  return rows.map(mapRow);
}

/** 新增用户 AI 配置 */
export async function createUserAiConfig(input: SaveUserAiConfigInput) {
  const user = currentUser();
  const [row] = await db
    .insert(userAiConfigs)
    .values({
      userId: user.userId,
      name: input.name ?? null,
      provider: input.provider ?? 'openai_compatible',
      baseUrl: input.baseUrl ?? null,
      apiKey: input.apiKey ? sealApiKey(input.apiKey) : null,
      model: input.model ?? null,
      temperature: input.temperature ?? null,
      maxTokens: input.maxTokens ?? null,
      systemPrompt: input.systemPrompt ?? null,
      isEnabled: input.isEnabled ?? true,
    })
    .returning();
  return mapRow(row);
}

/** 更新指定 ID 的用户 AI 配置 */
export async function updateUserAiConfig(id: number, input: SaveUserAiConfigInput) {
  const user = currentUser();
  const [existing] = await db
    .select()
    .from(userAiConfigs)
    .where(and(eq(userAiConfigs.id, id), eq(userAiConfigs.userId, user.userId)));
  if (!existing) throw new HTTPException(404, { message: '配置不存在' });

  const apiKey =
    input.apiKey && input.apiKey !== MASKED_KEY && !input.apiKey.includes('...')
      ? sealApiKey(input.apiKey)
      : (existing.apiKey ?? null);

  const [row] = await db
    .update(userAiConfigs)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.provider !== undefined && { provider: input.provider }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      apiKey,
      ...(input.model !== undefined && { model: input.model }),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
      ...(input.systemPrompt !== undefined && { systemPrompt: input.systemPrompt }),
      ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
    })
    .where(and(eq(userAiConfigs.id, id), eq(userAiConfigs.userId, user.userId)))
    .returning();
  return mapRow(row);
}

/** 删除指定 ID 的用户 AI 配置 */
export async function deleteUserAiConfig(id: number) {
  const user = currentUser();
  const [existing] = await db
    .select()
    .from(userAiConfigs)
    .where(and(eq(userAiConfigs.id, id), eq(userAiConfigs.userId, user.userId)));
  if (!existing) throw new HTTPException(404, { message: '配置不存在' });
  await db.delete(userAiConfigs).where(and(eq(userAiConfigs.id, id), eq(userAiConfigs.userId, user.userId)));
}

/** 内部使用：根据 userId 和配置 id 获取原始配置（解密后，用于聊天时校验权限） */
export async function getRawUserAiConfigById(id: number, userId: number) {
  const [row] = await db
    .select()
    .from(userAiConfigs)
    .where(and(eq(userAiConfigs.id, id), eq(userAiConfigs.userId, userId)));
  return row ? { ...row, apiKey: row.apiKey ? unsealApiKey(row.apiKey) : null } : null;
}
