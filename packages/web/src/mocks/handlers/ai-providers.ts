import { http, HttpResponse } from 'msw';
import { mockAiProviders, getNextProviderId, mockAiDateTime as mockDateTime } from '@/mocks/data/ai';
import type { AiProvider, AiProviderConfig } from '@zenith/shared';

const store = [...mockAiProviders];

export const aiProvidersHandlers = [
  // 测试连接（Demo 模拟）
  http.post('/api/ai/providers/test-connection', async () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: { success: true, message: '连接成功（Demo 模拟）' } });
  }),

  // 聊天可用模型（轻量列表：仅启用配置的非敏感字段）
  http.get('/api/ai/models', () => {
    const models = store
      .filter((p) => p.isEnabled)
      .map((p) => ({ id: p.id, name: p.name, model: p.model, provider: p.provider, isDefault: p.isDefault }));
    return HttpResponse.json({ code: 0, message: 'ok', data: models });
  }),

  // 列表
  http.get('/api/ai/providers', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: store });
  }),

  // 单条
  http.get('/api/ai/providers/:id', ({ params }) => {
    const id = Number(params.id);
    const item = store.find((p) => p.id === id);
    if (!item) return HttpResponse.json({ code: 404, message: '服务商不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: item });
  }),

  // 创建
  http.post('/api/ai/providers', async ({ request }) => {
    const body = await request.json() as Partial<AiProviderConfig>;
    const now = mockDateTime();
    const newItem: AiProviderConfig = {
      id: getNextProviderId(),
      name: body.name ?? '未命名服务商',
      provider: (body.provider ?? 'openai_compatible') as AiProvider,
      baseUrl: body.baseUrl ?? '',
      apiKey: body.apiKey ? `${(body.apiKey as string).slice(0, 4)}...${(body.apiKey as string).slice(-4)}` : '****',
      model: body.model ?? '',
      models: body.models ?? null,
      capabilities: body.capabilities ?? null,
      systemPrompt: body.systemPrompt ?? null,
      maxTokens: body.maxTokens ?? 4096,
      temperature: body.temperature ?? '0.7',
      priceInputPerM: body.priceInputPerM ?? null,
      priceOutputPerM: body.priceOutputPerM ?? null,
      isDefault: body.isDefault ?? false,
      isEnabled: body.isEnabled ?? true,
      fallbackConfigId: body.fallbackConfigId ?? null,
      maxConcurrent: body.maxConcurrent ?? null,
      createdAt: now,
      updatedAt: now,
    };
    if (newItem.isDefault) {
      store.forEach((p) => { p.isDefault = false; });
    }
    store.push(newItem);
    return HttpResponse.json({ code: 0, message: '创建成功', data: newItem });
  }),

  // 更新
  http.put('/api/ai/providers/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const idx = store.findIndex((p) => p.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '服务商不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<AiProviderConfig>;
    const now = mockDateTime();
    if (body.isDefault) {
      store.forEach((p) => { p.isDefault = false; });
    }
    store[idx] = {
      ...store[idx],
      ...body,
      apiKey: body.apiKey && !(body.apiKey as string).includes('...')
        ? `${(body.apiKey as string).slice(0, 4)}...${(body.apiKey as string).slice(-4)}`
        : store[idx].apiKey,
      id,
      updatedAt: now,
    };
    return HttpResponse.json({ code: 0, message: '修改成功', data: store[idx] });
  }),

  // 删除
  http.delete('/api/ai/providers/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = store.findIndex((p) => p.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '服务商不存在', data: null }, { status: 404 });
    store.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 设为默认
  http.post('/api/ai/providers/:id/set-default', ({ params }) => {
    const id = Number(params.id);
    const item = store.find((p) => p.id === id);
    if (!item) return HttpResponse.json({ code: 404, message: '服务商不存在', data: null }, { status: 404 });
    store.forEach((p) => { p.isDefault = p.id === id; });
    return HttpResponse.json({ code: 0, message: '已设为默认', data: null });
  }),
];
