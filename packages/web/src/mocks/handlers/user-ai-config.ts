import { userAiConfigContract } from '@zenith/shared/ai';
import type { UserAiConfig } from '@zenith/shared/ai';
import { mock } from '@/mocks/utils/contract';
import { notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockDateTime } from '../utils/date';

const mockUserAiConfigs: UserAiConfig[] = [];

/** 与服务端一致：列表 / 详情只返回脱敏后的 API Key */
function maskApiKey(apiKey: string) {
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export const userAiConfigHandlers = [
  mock(userAiConfigContract.list, ({ ok }) => ok(mockUserAiConfigs)),

  mock(userAiConfigContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const newCfg: UserAiConfig = {
      id: nextIdFrom(mockUserAiConfigs),
      userId: 1,
      name: body.name ?? null,
      providerId: body.providerId ?? 'custom',
      baseUrl: body.baseUrl ?? null,
      apiKey: body.apiKey ? maskApiKey(body.apiKey) : null,
      headers: body.headers ?? null,
      models: body.models ?? [],
      defaultModel: body.defaultModel ?? body.models?.[0] ?? null,
      modelSettings: body.modelSettings ?? null,
      providerOptions: body.providerOptions ?? null,
      capabilities: body.capabilities ?? null,
      systemPrompt: body.systemPrompt ?? null,
      isEnabled: body.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    mockUserAiConfigs.push(newCfg);
    return ok(newCfg, '创建成功');
  }),

  // 更新：脱敏格式的 apiKey 表示保持不变
  mock(userAiConfigContract.update, ({ params, body, ok }) => {
    const idx = mockUserAiConfigs.findIndex((c) => c.id === params.id);
    if (idx < 0) return notFound('配置不存在', { status: 404 });
    const existing = mockUserAiConfigs[idx];
    const { apiKey, ...rest } = body;
    const updated: UserAiConfig = {
      ...existing,
      ...rest,
      apiKey: apiKey && !apiKey.includes('...') ? maskApiKey(apiKey) : existing.apiKey,
      updatedAt: mockDateTime(),
    };
    mockUserAiConfigs[idx] = updated;
    return ok(updated, '更新成功');
  }),

  mock(userAiConfigContract.remove, ({ params, ok }) => {
    const idx = mockUserAiConfigs.findIndex((c) => c.id === params.id);
    if (idx < 0) return notFound('配置不存在', { status: 404 });
    mockUserAiConfigs.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
