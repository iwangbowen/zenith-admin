import { eq, desc, and } from 'drizzle-orm';
import { db } from '../../db';
import { aiProviderConfigs } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { encryptField, decryptField } from '../../lib/encryption';
import { HTTPException } from 'hono/http-exception';
import type { CreateAiProviderConfigInput, UpdateAiProviderConfigInput, TestAiConnectionInput, FetchAiModelsInput } from '@zenith/shared';
import { httpRequest } from '../../lib/http-client';

const MASKED_KEY = '******';
/** 加密存储前缀：`enc:v1:` + AES-256-GCM base64 */
const ENC_PREFIX = 'enc:v1:';

/** 加密 API Key 入库（幂等：已加密的不重复加密） */
export function sealApiKey(plain: string): string {
  if (!plain || plain.startsWith(ENC_PREFIX)) return plain;
  return `${ENC_PREFIX}${encryptField(plain)}`;
}

/** 解密 API Key（兼容历史明文：无前缀原样返回） */
export function unsealApiKey(stored: string | null | undefined): string {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  return decryptField(stored.slice(ENC_PREFIX.length)) ?? '';
}

function maskApiKey(apiKey: string): string {
  const plain = unsealApiKey(apiKey);
  if (!plain) return '';
  if (plain.length <= 8) return MASKED_KEY;
  return `${plain.slice(0, 4)}...${plain.slice(-4)}`;
}

function mapRow(row: typeof aiProviderConfigs.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKey: maskApiKey(row.apiKey),
    model: row.model,
    models: row.models,
    capabilities: row.capabilities,
    systemPrompt: row.systemPrompt,
    maxTokens: row.maxTokens,
    temperature: row.temperature,
    priceInputPerM: row.priceInputPerM,
    priceOutputPerM: row.priceOutputPerM,
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

/** 聊天模型选择器用：启用配置的轻量列表（不含密钥/地址等敏感字段，所有登录用户可见）；多模型配置展开为多个条目 */
export async function listChatModels() {
  const rows = await db
    .select({
      id: aiProviderConfigs.id,
      name: aiProviderConfigs.name,
      model: aiProviderConfigs.model,
      models: aiProviderConfigs.models,
      provider: aiProviderConfigs.provider,
      isDefault: aiProviderConfigs.isDefault,
      capabilities: aiProviderConfigs.capabilities,
    })
    .from(aiProviderConfigs)
    .where(eq(aiProviderConfigs.isEnabled, true))
    .orderBy(desc(aiProviderConfigs.isDefault), desc(aiProviderConfigs.createdAt));
  return rows.flatMap((r) => {
    const extraModels = (r.models ?? []).filter((m) => m && m !== r.model);
    return [r.model, ...extraModels].map((model, idx) => ({
      id: r.id,
      name: r.name,
      model,
      provider: r.provider,
      isDefault: r.isDefault && idx === 0,
      capabilities: r.capabilities ?? null,
    }));
  });
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
        apiKey: sealApiKey(input.apiKey),
        model: input.model,
        models: input.models ?? null,
        capabilities: input.capabilities ?? null,
        systemPrompt: input.systemPrompt ?? null,
        maxTokens: input.maxTokens ?? 4096,
        temperature: input.temperature ?? '0.7',
        priceInputPerM: input.priceInputPerM ?? null,
        priceOutputPerM: input.priceOutputPerM ?? null,
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

  // 如果传入的 apiKey 是脱敏格式则保留原始值；新密钥加密入库
  const apiKey =
    input.apiKey && input.apiKey !== MASKED_KEY && !input.apiKey.includes('...')
      ? sealApiKey(input.apiKey)
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
        ...(input.models !== undefined && { models: input.models }),
        ...(input.capabilities !== undefined && { capabilities: input.capabilities }),
        ...(input.systemPrompt !== undefined && { systemPrompt: input.systemPrompt }),
        ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
        ...(input.temperature !== undefined && { temperature: input.temperature }),
        ...(input.priceInputPerM !== undefined && { priceInputPerM: input.priceInputPerM }),
        ...(input.priceOutputPerM !== undefined && { priceOutputPerM: input.priceOutputPerM }),
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

/** 获取原始（解密后）配置，供内部 AI 调用使用 */
export async function getRawProviderConfig(id: number) {
  const [row] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  if (!row) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });
  return { ...row, apiKey: unsealApiKey(row.apiKey) };
}

/** 获取默认原始配置（解密后） */
export async function getRawDefaultProviderConfig() {
  const [row] = await db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.isDefault, true), eq(aiProviderConfigs.isEnabled, true)));
  return row ? { ...row, apiKey: unsealApiKey(row.apiKey) } : null;
}

/** 测试连接：发送一条简单消息验证配置可用性 */
export async function testAiProviderConnection(input: TestAiConnectionInput): Promise<{ success: boolean; message: string }> {
  let apiKey = input.apiKey ?? '';

  // 若 apiKey 为空或含脱敏标记，且提供了 id，则从 DB 取真实密钥
  if ((!apiKey || apiKey.includes('...') || apiKey === '******') && input.id) {
    const [row] = await db.select({ apiKey: aiProviderConfigs.apiKey }).from(aiProviderConfigs).where(eq(aiProviderConfigs.id, input.id));
    if (!row) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });
    apiKey = unsealApiKey(row.apiKey);
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

/**
 * 从供应商 API 自动发现可用模型列表。
 * openai_compatible: GET {base}/models；anthropic: GET {base}/v1/models；gemini: GET {base}/v1beta/models
 */
export async function fetchProviderModels(input: FetchAiModelsInput): Promise<string[]> {
  let apiKey = input.apiKey ?? '';
  if ((!apiKey || apiKey.includes('...') || apiKey === '******') && input.id) {
    const [row] = await db.select({ apiKey: aiProviderConfigs.apiKey }).from(aiProviderConfigs).where(eq(aiProviderConfigs.id, input.id));
    if (!row) throw new HTTPException(404, { message: 'AI 服务商配置不存在' });
    apiKey = unsealApiKey(row.apiKey);
  }
  if (!apiKey) throw new HTTPException(400, { message: 'API Key 不能为空' });

  const provider = input.provider ?? 'openai_compatible';
  const base = input.baseUrl.replace(/\/$/, '');
  let url: string;
  let headers: Record<string, string>;
  if (provider === 'anthropic') {
    url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
    headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  } else if (provider === 'gemini') {
    const geminiBase = /\/v1(beta)?$/.test(base) ? base : `${base}/v1beta`;
    url = `${geminiBase}/models`;
    headers = { 'x-goog-api-key': apiKey };
  } else {
    url = `${base}/models`;
    headers = { Authorization: `Bearer ${apiKey}` };
  }

  const res = await httpRequest(url, { method: 'GET', headers, timeout: 15000 });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) msg = parsed.error.message;
    } catch { /* ignore */ }
    throw new HTTPException(400, { message: `获取模型列表失败：${msg}` });
  }
  const data = await res.json<{ data?: { id?: string }[]; models?: { name?: string }[] }>();
  let models: string[] = [];
  if (Array.isArray(data.data)) {
    models = data.data.map((m) => m.id ?? '').filter(Boolean);
  } else if (Array.isArray(data.models)) {
    // Gemini：name 形如 models/gemini-2.0-flash
    models = data.models.map((m) => (m.name ?? '').replace(/^models\//, '')).filter(Boolean);
  }
  return [...new Set(models)].sort((a, b) => a.localeCompare(b)).slice(0, 200);
}
