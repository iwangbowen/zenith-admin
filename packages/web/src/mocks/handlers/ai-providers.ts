import { aiChatModelContract, aiProviderContract, AI_COMMON_PROVIDERS, AI_CUSTOM_PROVIDER_ID } from '@zenith/shared/ai';
import type { AiProviderCatalogEntry, AiProviderConfig } from '@zenith/shared/ai';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockAiProviders, getNextProviderId } from '@/mocks/data/ai';
import { mockDateTime } from '@/mocks/utils/date';

const store = [...mockAiProviders];

/** Demo 目录:常用服务商 + 每家几款代表模型 */
const CATALOG_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  alibaba: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  moonshotai: ['kimi-k2', 'moonshot-v1-128k'],
  zhipuai: ['glm-4.6', 'glm-4.5-air'],
  minimax: ['minimax-m2'],
  siliconflow: ['deepseek-v3', 'qwen3-32b'],
  xai: ['grok-4', 'grok-3-mini'],
  mistral: ['mistral-large-latest', 'mistral-small-latest'],
  groq: ['llama-3.3-70b-versatile'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-5'],
};

/** 与服务端一致：列表 / 详情只返回脱敏后的 API Key */
function maskApiKey(apiKey: string) {
  return apiKey.includes('...') ? apiKey : `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export const aiProvidersHandlers = [
  // 测试连接（Demo 模拟）
  mock(aiProviderContract.testConnection, ({ ok }) => ok({ success: true, message: '连接成功（Demo 模拟）' })),

  // 服务商目录（Demo：常用清单）
  mock(aiProviderContract.catalog, ({ ok }) => {
    const entries: AiProviderCatalogEntry[] = AI_COMMON_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.label,
      docUrl: null,
      common: true,
      modelCount: CATALOG_MODELS[p.id]?.length ?? 0,
    }));
    return ok(entries);
  }),

  // 目录内某服务商的模型清单
  mock(aiProviderContract.catalogModels, ({ params, ok }) => {
    if (params.providerId === AI_CUSTOM_PROVIDER_ID) return ok([]);
    return ok(CATALOG_MODELS[params.providerId] ?? []);
  }),

  // 从供应商 API 自动发现模型（Demo：返回目录样例）
  mock(aiProviderContract.fetchModels, ({ body, ok }) => ok(CATALOG_MODELS[body.providerId] ?? ['demo-model-a', 'demo-model-b'])),

  // 聊天可用模型（轻量列表：仅启用配置的非敏感字段）
  mock(aiChatModelContract.list, ({ ok }) => {
    const models = store
      .filter((p) => p.isEnabled)
      .flatMap((p) => {
        const rest = p.models.filter((m) => m !== p.defaultModel);
        return [p.defaultModel, ...rest].map((model, idx) => ({
          id: p.id, name: p.name, model, providerId: p.providerId, isDefault: p.isDefault && idx === 0, capabilities: p.capabilities ?? null,
        }));
      });
    return ok(models);
  }),

  // 列表
  mock(aiProviderContract.list, ({ ok }) => ok(store)),

  // 单条
  mock(aiProviderContract.detail, ({ params, ok }) => {
    const item = store.find((p) => p.id === params.id);
    if (!item) return notFound('服务商不存在', { status: 404 });
    return ok(item);
  }),

  // 创建：body 即 CreateAiProviderConfigInput（已校验、已补默认值）
  mock(aiProviderContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const newItem: AiProviderConfig = {
      id: getNextProviderId(),
      name: body.name,
      providerId: body.providerId,
      baseUrl: body.baseUrl ?? null,
      apiKey: maskApiKey(body.apiKey),
      headers: body.headers ?? null,
      models: body.models,
      defaultModel: body.defaultModel,
      modelSettings: body.modelSettings ?? null,
      providerOptions: body.providerOptions ?? null,
      fallbacks: body.fallbacks ?? null,
      capabilities: body.capabilities ?? null,
      priceInputPerM: body.priceInputPerM ?? null,
      priceOutputPerM: body.priceOutputPerM ?? null,
      isDefault: body.isDefault,
      isEnabled: body.isEnabled,
      maxConcurrent: body.maxConcurrent ?? null,
      createdAt: now,
      updatedAt: now,
    };
    if (newItem.isDefault) {
      store.forEach((p) => { p.isDefault = false; });
    }
    store.push(newItem);
    return ok(newItem, '创建成功');
  }),

  // 更新：脱敏格式的 apiKey 表示保持不变
  mock(aiProviderContract.update, ({ params, body, ok }) => {
    const idx = store.findIndex((p) => p.id === params.id);
    if (idx === -1) return notFound('服务商不存在', { status: 404 });
    if (body.isDefault) {
      store.forEach((p) => { p.isDefault = false; });
    }
    const { apiKey, ...rest } = body;
    store[idx] = {
      ...store[idx],
      ...rest,
      apiKey: apiKey && !apiKey.includes('...') ? maskApiKey(apiKey) : store[idx].apiKey,
      id: params.id,
      updatedAt: mockDateTime(),
    };
    return ok(store[idx], '修改成功');
  }),

  // 删除
  mock(aiProviderContract.remove, ({ params, ok }) => {
    const idx = store.findIndex((p) => p.id === params.id);
    if (idx === -1) return notFound('服务商不存在', { status: 404 });
    store.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // 设为默认
  mock(aiProviderContract.setDefault, ({ params, ok }) => {
    const item = store.find((p) => p.id === params.id);
    if (!item) return notFound('服务商不存在', { status: 404 });
    store.forEach((p) => { p.isDefault = p.id === params.id; });
    return ok(item, '已设为默认');
  }),
];
