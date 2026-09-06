import { and, eq } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { userAiConfigs } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { sealApiKey, unsealApiKey } from './ai-providers.service';
import type { SaveUserAiConfigInput } from '@zenith/shared/ai';
import { maskSecret, SECRET_PLACEHOLDER } from '@zenith/shared/core';

function mapRow(row: typeof userAiConfigs.$inferSelect) {
  const plainKey = unsealApiKey(row.apiKey);
  return {
    id: row.id,
    userId: row.userId,
    name: row.name ?? null,
    providerId: row.providerId,
    baseUrl: row.baseUrl,
    // 与全局服务商配置同口径（头 4 + ... + 尾 4，过短整体占位）
    apiKey: plainKey ? maskSecret(plainKey, { filler: '...', short: SECRET_PLACEHOLDER }) : null,
    headers: row.headers ?? null,
    models: row.models ?? [],
    defaultModel: row.defaultModel ?? null,
    modelSettings: row.modelSettings,
    providerOptions: row.providerOptions ?? null,
    capabilities: row.capabilities ?? null,
    systemPrompt: row.systemPrompt,
    isEnabled: row.isEnabled,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** defaultModel 必须包含在 models 中（与全局服务商配置同款约束） */
function assertDefaultInModels(models: string[] | undefined, defaultModel: string | null | undefined) {
  if (models && models.length > 0 && defaultModel && !models.includes(defaultModel)) {
    throw new HTTPException(400, { message: '默认模型必须包含在模型列表中' });
  }
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
  assertDefaultInModels(input.models, input.defaultModel);
  const [row] = await db
    .insert(userAiConfigs)
    .values({
      userId: user.userId,
      name: input.name ?? null,
      providerId: input.providerId ?? 'custom',
      baseUrl: input.baseUrl ?? null,
      apiKey: input.apiKey ? sealApiKey(input.apiKey) : null,
      headers: input.headers ?? null,
      models: input.models ?? [],
      defaultModel: input.defaultModel ?? input.models?.[0] ?? null,
      modelSettings: input.modelSettings ?? null,
      providerOptions: input.providerOptions ?? null,
      capabilities: input.capabilities ?? null,
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
  requireRow(existing, '配置不存在');

  const nextModels = input.models ?? existing.models ?? [];
  const nextDefault = input.defaultModel !== undefined ? input.defaultModel : existing.defaultModel;
  assertDefaultInModels(nextModels, nextDefault);

  const apiKey =
    input.apiKey && input.apiKey !== SECRET_PLACEHOLDER && !input.apiKey.includes('...')
      ? sealApiKey(input.apiKey)
      : (existing.apiKey ?? null);

  const [row] = await db
    .update(userAiConfigs)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.providerId !== undefined && { providerId: input.providerId }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      apiKey,
      ...(input.headers !== undefined && { headers: input.headers }),
      ...(input.models !== undefined && { models: input.models }),
      ...(input.defaultModel !== undefined && { defaultModel: input.defaultModel ?? input.models?.[0] ?? null }),
      ...(input.modelSettings !== undefined && { modelSettings: input.modelSettings }),
      ...(input.providerOptions !== undefined && { providerOptions: input.providerOptions }),
      ...(input.capabilities !== undefined && { capabilities: input.capabilities }),
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
  requireRow(existing, '配置不存在');
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
