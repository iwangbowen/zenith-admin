import { eq, desc, and } from 'drizzle-orm';
import { db } from '../../db';
import { aiProviderConfigs } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { HTTPException } from 'hono/http-exception';
import type { CreateAiProviderConfigInput, UpdateAiProviderConfigInput, TestAiConnectionInput } from '@zenith/shared';
import { httpRequest } from '../../lib/http-client';

const MASKED_KEY = '******';

function maskApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return MASKED_KEY;
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function mapRow(row: typeof aiProviderConfigs.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKey: maskApiKey(row.apiKey),
    model: row.model,
    systemPrompt: row.systemPrompt,
    maxTokens: row.maxTokens,
    temperature: row.temperature,
    isDefault: row.isDefault,
    isEnabled: row.isEnabled,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listAiProviderConfigs() {
  const rows = await db.select().from(aiProviderConfigs).orderBy(desc(aiProviderConfigs.isDefault), desc(aiProviderConfigs.createdAt));
  return rows.map(mapRow);
}

/** 聊天模型选择器用：启用配置的轻量列表（不含密钥/地址等敏感字段，所有登录用户可见） */
export async function listChatModels() {
  return db
    .select({
      id: aiProviderConfigs.id,
      name: aiProviderConfigs.name,
      model: aiProviderConfigs.model,
      provider: aiProviderConfigs.provider,
      isDefault: aiProviderConfigs.isDefault,
    })
    .from(aiProviderConfigs)
    .where(eq(aiProviderConfigs.isEnabled, true))
    .orderBy(desc(aiProviderConfigs.isDefault), desc(aiProviderConfigs.createdAt));
}

export async function getAiProviderConfig(id: number) {
  const [row] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  if (!row) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });
  return mapRow(row);
}

export async function getDefaultProviderConfig() {
  const [row] = await db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.isDefault, true), eq(aiProviderConfigs.isEnabled, true)));
  return row ?? null;
}

export async function createAiProviderConfig(input: CreateAiProviderConfigInput) {
  const user = currentUser();
  if (input.isDefault) {
    await db.update(aiProviderConfigs).set({ isDefault: false });
  }
  try {
    const [row] = await db
      .insert(aiProviderConfigs)
      .values({
        name: input.name,
        provider: input.provider ?? 'openai_compatible',
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        systemPrompt: input.systemPrompt ?? null,
        maxTokens: input.maxTokens ?? 4096,
        temperature: input.temperature ?? '0.7',
        isDefault: input.isDefault ?? false,
        isEnabled: input.isEnabled ?? true,
        createdBy: user.userId,
        updatedBy: user.userId,
      })
      .returning();
    return mapRow(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '配置名称已存在');
    throw err;
  }
}

export async function updateAiProviderConfig(id: number, input: UpdateAiProviderConfigInput) {
  const user = currentUser();
  const [existing] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  if (!existing) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });

  if (input.isDefault === true) {
    await db.update(aiProviderConfigs).set({ isDefault: false });
  }

  // 如果传入的 apiKey 是脱敏格式则保留原始值
  const apiKey =
    input.apiKey && input.apiKey !== MASKED_KEY && !input.apiKey.includes('...')
      ? input.apiKey
      : existing.apiKey;

  try {
    const [row] = await db
      .update(aiProviderConfigs)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.provider !== undefined && { provider: input.provider }),
        ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
        apiKey,
        ...(input.model !== undefined && { model: input.model }),
        ...(input.systemPrompt !== undefined && { systemPrompt: input.systemPrompt }),
        ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
        ...(input.temperature !== undefined && { temperature: input.temperature }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
        updatedBy: user.userId,
      })
      .where(eq(aiProviderConfigs.id, id))
      .returning();
    return mapRow(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '配置名称已存在');
    throw err;
  }
}

export async function deleteAiProviderConfig(id: number) {
  const result = await db.delete(aiProviderConfigs).where(eq(aiProviderConfigs.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });
}

export async function setDefaultAiProviderConfig(id: number) {
  const [existing] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  if (!existing) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });
  await db.update(aiProviderConfigs).set({ isDefault: false });
  const [row] = await db.update(aiProviderConfigs).set({ isDefault: true }).where(eq(aiProviderConfigs.id, id)).returning();
  return mapRow(row);
}

/** 获取原始（未脱敏）配置，供内部 AI 调用使用 */
export async function getRawProviderConfig(id: number) {
  const [row] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  if (!row) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });
  return row;
}

/** 获取默认原始配置 */
export async function getRawDefaultProviderConfig() {
  const [row] = await db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.isDefault, true), eq(aiProviderConfigs.isEnabled, true)));
  return row ?? null;
}

/** 测试连接：发送一条简单消息验证配置可用性 */
export async function testAiProviderConnection(input: TestAiConnectionInput): Promise<{ success: boolean; message: string }> {
  let apiKey = input.apiKey ?? '';

  // 若 apiKey 为空或含脱敏标记，且提供了 id，则从 DB 取真实密钥
  if ((!apiKey || apiKey.includes('...') || apiKey === '******') && input.id) {
    const [row] = await db.select({ apiKey: aiProviderConfigs.apiKey }).from(aiProviderConfigs).where(eq(aiProviderConfigs.id, input.id));
    if (!row) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });
    apiKey = row.apiKey;
  }

  if (!apiKey) throw new HTTPException(400, { message: 'API Key 不能为空' });

  const url = `${input.baseUrl.replace(/\/$/, '')}/chat/completions`;
  try {
    const res = await httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
        stream: false,
      }),
      timeout: 15000,
    });

    if (res.ok) {
      return { success: true, message: '连接成功' };
    }
    const body = await res.text().catch(() => '');
    let errMsg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed?.error?.message) errMsg = parsed.error.message;
    } catch { /* ignore */ }
    return { success: false, message: errMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}
