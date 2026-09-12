import { eq, desc, and } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { clearDefaultFlag } from '../../lib/default-flag';
import { db } from '../../db';
import { aiProviderConfigs } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatTimestamps } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { encryptField, decryptField } from '../../lib/encryption';
import { AI_SSRF_OPTIONS } from '../../lib/ai/outbound';
import { chatOnce } from '../../lib/ai/mastra-chat';
import { loadMastraLlmModule } from '../../lib/ai/mastra-models';
import { AI_COMMON_PROVIDERS, AI_CUSTOM_PROVIDER_ID } from '@zenith/shared/ai';
import { maskSecret, SECRET_PLACEHOLDER } from '@zenith/shared/core';
import { HTTPException } from 'hono/http-exception';
import type {
  AiProviderCatalogEntry,
  CreateAiProviderConfigInput,
  UpdateAiProviderConfigInput,
  TestAiConnectionInput,
  FetchAiModelsInput,
} from '@zenith/shared/ai';
import { httpRequest } from '../../lib/http-client';

/** API Key 展示口径：头 4 + `...` + 尾 4；过短整体输出占位（`@zenith/shared/core` maskSecret） */
const API_KEY_MASK_OPTIONS = { filler: '...', short: SECRET_PLACEHOLDER } as const;
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
  return maskSecret(plain, API_KEY_MASK_OPTIONS);
}

function mapRow(row: typeof aiProviderConfigs.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    providerId: row.providerId,
    baseUrl: row.baseUrl,
    apiKey: maskApiKey(row.apiKey),
    headers: row.headers,
    models: row.models,
    defaultModel: row.defaultModel,
    modelSettings: row.modelSettings,
    providerOptions: row.providerOptions,
    fallbacks: row.fallbacks,
    capabilities: row.capabilities,
    priceInputPerM: row.priceInputPerM,
    priceOutputPerM: row.priceOutputPerM,
    isDefault: row.isDefault,
    isEnabled: row.isEnabled,
    maxConcurrent: row.maxConcurrent,
    ...formatTimestamps(row),
  };
}

/** 业务前置校验：custom 必填 baseUrl、默认模型必须在启用模型内、降级链不得引用自身 */
function ensureProviderConfigInput(input: {
  providerId?: string;
  baseUrl?: string | null;
  models?: string[];
  defaultModel?: string;
  fallbacks?: { configId: number }[] | null;
}, selfId?: number): void {
  if (input.providerId === AI_CUSTOM_PROVIDER_ID && input.baseUrl !== undefined && !input.baseUrl) {
    throw new HTTPException(400, { message: '自定义服务商必须填写 API 地址' });
  }
  if (input.models && input.defaultModel && !input.models.includes(input.defaultModel)) {
    throw new HTTPException(400, { message: '默认模型必须在启用模型列表中' });
  }
  if (selfId && input.fallbacks?.some((f) => f.configId === selfId)) {
    throw new HTTPException(400, { message: '降级链不能引用当前配置自身' });
  }
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
      models: aiProviderConfigs.models,
      defaultModel: aiProviderConfigs.defaultModel,
      providerId: aiProviderConfigs.providerId,
      isDefault: aiProviderConfigs.isDefault,
      capabilities: aiProviderConfigs.capabilities,
    })
    .from(aiProviderConfigs)
    .where(eq(aiProviderConfigs.isEnabled, true))
    .orderBy(desc(aiProviderConfigs.isDefault), desc(aiProviderConfigs.createdAt));
  return rows.flatMap((r) => {
    const rest = (r.models ?? []).filter((m) => m && m !== r.defaultModel);
    return [r.defaultModel, ...rest].map((model, idx) => ({
      id: r.id,
      name: r.name,
      model,
      providerId: r.providerId,
      isDefault: r.isDefault && idx === 0,
      capabilities: r.capabilities ?? null,
    }));
  });
}

export async function getAiProviderConfig(id: number) {
  const [row] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  requireRow(row, 'AI 服务商配置不存在');
  return mapRow(row);
}

export async function getDefaultProviderConfig() {
  const [row] = await db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.isDefault, true), eq(aiProviderConfigs.isEnabled, true)));
  return row ?? null;
}

export async function createAiProviderConfig(input: CreateAiProviderConfigInput) {
  const user = currentUser();
  ensureProviderConfigInput({ ...input, baseUrl: input.baseUrl ?? null });
  if (input.providerId === AI_CUSTOM_PROVIDER_ID && !input.baseUrl) {
    throw new HTTPException(400, { message: '自定义服务商必须填写 API 地址' });
  }
  if (input.isDefault) {
    await clearDefaultFlag(db, aiProviderConfigs);
  }
  try {
    const [row] = await db
      .insert(aiProviderConfigs)
      .values({
        name: input.name,
        providerId: input.providerId,
        baseUrl: input.baseUrl ?? null,
        apiKey: sealApiKey(input.apiKey),
        headers: input.headers ?? null,
        models: input.models,
        defaultModel: input.defaultModel,
        modelSettings: input.modelSettings ?? null,
        providerOptions: input.providerOptions ?? null,
        fallbacks: input.fallbacks ?? null,
        capabilities: input.capabilities ?? null,
        priceInputPerM: input.priceInputPerM ?? null,
        priceOutputPerM: input.priceOutputPerM ?? null,
        maxConcurrent: input.maxConcurrent ?? null,
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
  requireRow(existing, 'AI 服务商配置不存在');

  const merged = {
    providerId: input.providerId ?? existing.providerId,
    baseUrl: input.baseUrl !== undefined ? input.baseUrl : existing.baseUrl,
    models: input.models ?? existing.models,
    defaultModel: input.defaultModel ?? existing.defaultModel,
    fallbacks: input.fallbacks !== undefined ? input.fallbacks : existing.fallbacks,
  };
  if (merged.providerId === AI_CUSTOM_PROVIDER_ID && !merged.baseUrl) {
    throw new HTTPException(400, { message: '自定义服务商必须填写 API 地址' });
  }
  ensureProviderConfigInput(merged, id);

  if (input.isDefault === true) {
    await clearDefaultFlag(db, aiProviderConfigs);
  }

  // 如果传入的 apiKey 是脱敏格式则保留原始值；新密钥加密入库
  const apiKey =
    input.apiKey && input.apiKey !== SECRET_PLACEHOLDER && !input.apiKey.includes('...')
      ? sealApiKey(input.apiKey)
      : existing.apiKey;

  try {
    const [row] = await db
      .update(aiProviderConfigs)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.providerId !== undefined && { providerId: input.providerId }),
        ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
        apiKey,
        ...(input.headers !== undefined && { headers: input.headers }),
        ...(input.models !== undefined && { models: input.models }),
        ...(input.defaultModel !== undefined && { defaultModel: input.defaultModel }),
        ...(input.modelSettings !== undefined && { modelSettings: input.modelSettings }),
        ...(input.providerOptions !== undefined && { providerOptions: input.providerOptions }),
        ...(input.fallbacks !== undefined && { fallbacks: input.fallbacks }),
        ...(input.capabilities !== undefined && { capabilities: input.capabilities }),
        ...(input.priceInputPerM !== undefined && { priceInputPerM: input.priceInputPerM }),
        ...(input.priceOutputPerM !== undefined && { priceOutputPerM: input.priceOutputPerM }),
        ...(input.maxConcurrent !== undefined && { maxConcurrent: input.maxConcurrent }),
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
  requireRow(result[0], 'AI 服务商配置不存在');
}

export async function setDefaultAiProviderConfig(id: number) {
  const [existing] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  requireRow(existing, 'AI 服务商配置不存在');
  await clearDefaultFlag(db, aiProviderConfigs);
  const [row] = await db.update(aiProviderConfigs).set({ isDefault: true }).where(eq(aiProviderConfigs.id, id)).returning();
  return mapRow(row);
}

/** 获取原始（解密后）配置，供内部 AI 调用使用 */
export async function getRawProviderConfig(id: number) {
  const [row] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  requireRow(row, 'AI 服务商配置不存在');
  return { ...row, apiKey: unsealApiKey(row.apiKey) };
}

/** 获取默认原始配置（解密后） */
export async function getRawDefaultProviderConfig() {
  const [row] = await db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.isDefault, true), eq(aiProviderConfigs.isEnabled, true)));
  return row ? { ...row, apiKey: unsealApiKey(row.apiKey) } : null;
}

/** 解析测试/拉模型入参中的 apiKey（脱敏值回落到 DB 真实密钥） */
async function resolveInputApiKey(apiKey: string | undefined, id: number | undefined): Promise<string> {
  let key = apiKey ?? '';
  if ((!key || key.includes('...') || key === SECRET_PLACEHOLDER) && id) {
    const [row] = await db.select({ apiKey: aiProviderConfigs.apiKey }).from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
    requireRow(row, 'AI 服务商配置不存在');
    key = unsealApiKey(row.apiKey);
  }
  if (!key) throw new HTTPException(400, { message: 'API Key 不能为空' });
  return key;
}

/** 测试连接：经 Mastra 模型路由发送一条最小消息（任意目录服务商 / 自定义端点均可测） */
export async function testAiProviderConnection(input: TestAiConnectionInput): Promise<{ success: boolean; message: string }> {
  const apiKey = await resolveInputApiKey(input.apiKey, input.id);
  if (input.providerId === AI_CUSTOM_PROVIDER_ID && !input.baseUrl) {
    throw new HTTPException(400, { message: '自定义服务商必须填写 API 地址' });
  }
  try {
    await chatOnce({
      chain: [{
        source: { providerId: input.providerId, baseUrl: input.baseUrl ?? null, apiKey },
        model: input.model,
        maxRetries: 0,
      }],
      messages: [{ role: 'user', content: 'Hi' }],
      modelSettings: { maxOutputTokens: 10 },
      timeoutMs: 15000,
    });
    return { success: true, message: '连接成功' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}

/**
 * 获取服务商可用模型列表：
 * - 填写了 baseUrl（custom / 覆盖端点）：GET {base}/models 实时发现（OpenAI 兼容协议）
 * - 目录服务商未填 baseUrl：直接返回 Mastra 目录内该服务商的模型清单
 */
export async function fetchProviderModels(input: FetchAiModelsInput): Promise<string[]> {
  if (!input.baseUrl) {
    if (input.providerId === AI_CUSTOM_PROVIDER_ID) {
      throw new HTTPException(400, { message: '自定义服务商必须填写 API 地址' });
    }
    const { getProviderConfig } = await loadMastraLlmModule();
    const provider = getProviderConfig(input.providerId);
    if (!provider) throw new HTTPException(400, { message: '未知服务商，请填写 API 地址后从 API 获取' });
    return [...provider.models].sort((a, b) => a.localeCompare(b));
  }

  const apiKey = await resolveInputApiKey(input.apiKey, input.id);
  const base = input.baseUrl.replace(/\/$/, '');
  const res = await httpRequest(`${base}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 15000,
    ...AI_SSRF_OPTIONS,
  });
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
    models = data.models.map((m) => (m.name ?? '').replace(/^models\//, '')).filter(Boolean);
  }
  return [...new Set(models)].sort((a, b) => a.localeCompare(b)).slice(0, 200);
}

/** 服务商目录（Mastra PROVIDER_REGISTRY,常用项排前）；custom 恒在首位 */
export async function getProviderCatalog(): Promise<AiProviderCatalogEntry[]> {
  const { PROVIDER_REGISTRY } = await loadMastraLlmModule();
  const commonIds = new Map(AI_COMMON_PROVIDERS.map((p, i) => [p.id, i]));
  const entries: AiProviderCatalogEntry[] = Object.entries(PROVIDER_REGISTRY as Record<string, { name: string; models: string[]; docUrl?: string }>)
    .map(([id, cfg]) => ({
      id,
      name: cfg.name || id,
      docUrl: cfg.docUrl ?? null,
      common: commonIds.has(id),
      modelCount: cfg.models?.length ?? 0,
    }));
  entries.sort((a, b) => {
    if (a.common !== b.common) return a.common ? -1 : 1;
    if (a.common && b.common) return (commonIds.get(a.id) ?? 99) - (commonIds.get(b.id) ?? 99);
    return a.name.localeCompare(b.name);
  });
  const customLabel = AI_COMMON_PROVIDERS.find((p) => p.id === AI_CUSTOM_PROVIDER_ID)?.label ?? '自定义(OpenAI 兼容)';
  return [
    { id: AI_CUSTOM_PROVIDER_ID, name: customLabel, docUrl: null, common: true, modelCount: 0 },
    ...entries.filter((e) => e.id !== AI_CUSTOM_PROVIDER_ID),
  ];
}

/** 目录内某服务商的模型清单 */
export async function getCatalogProviderModels(providerId: string): Promise<string[]> {
  if (providerId === AI_CUSTOM_PROVIDER_ID) return [];
  const { getProviderConfig } = await loadMastraLlmModule();
  const provider = getProviderConfig(providerId);
  if (!provider) throw new HTTPException(404, { message: '服务商不在目录中' });
  return [...provider.models];
}
