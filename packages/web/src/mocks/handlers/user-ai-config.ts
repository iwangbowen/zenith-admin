import { http, HttpResponse } from 'msw';
import type { UserAiConfig } from '@zenith/shared';
import { mockDateTime } from '../utils/date';

const mockUserAiConfigs: UserAiConfig[] = [];
let nextId = 1;

export const userAiConfigHandlers = [
  // GET /api/ai/user-configs
  http.get('/api/ai/user-configs', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: mockUserAiConfigs });
  }),

  // POST /api/ai/user-configs
  http.post('/api/ai/user-configs', async ({ request }) => {
    const body = await request.json() as Partial<UserAiConfig>;
    const now = mockDateTime();
    const newCfg: UserAiConfig = {
      id: nextId++,
      userId: 1,
      name: body.name ?? null,
      provider: body.provider ?? 'openai_compatible',
      baseUrl: body.baseUrl ?? null,
      apiKey: body.apiKey ? `${String(body.apiKey).slice(0, 4)}...${String(body.apiKey).slice(-4)}` : null,
      model: body.model ?? null,
      temperature: body.temperature ?? null,
      maxTokens: body.maxTokens ?? null,
      systemPrompt: body.systemPrompt ?? null,
      isEnabled: body.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    mockUserAiConfigs.push(newCfg);
    return HttpResponse.json({ code: 0, message: '创建成功', data: newCfg });
  }),

  // PUT /api/ai/user-configs/:id
  http.put('/api/ai/user-configs/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as Partial<UserAiConfig>;
    const now = mockDateTime();
    const idx = mockUserAiConfigs.findIndex((c) => c.id === id);
    if (idx < 0) return HttpResponse.json({ code: 404, message: '配置不存在', data: null }, { status: 404 });
    const existing = mockUserAiConfigs[idx];
    const updated: UserAiConfig = {
      ...existing,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.provider !== undefined && { provider: body.provider }),
      ...(body.baseUrl !== undefined && { baseUrl: body.baseUrl }),
      apiKey: body.apiKey && !String(body.apiKey).includes('...') ? `${String(body.apiKey).slice(0, 4)}...${String(body.apiKey).slice(-4)}` : existing.apiKey,
      ...(body.model !== undefined && { model: body.model }),
      ...(body.temperature !== undefined && { temperature: body.temperature }),
      ...(body.maxTokens !== undefined && { maxTokens: body.maxTokens }),
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
      ...(body.isEnabled !== undefined && { isEnabled: body.isEnabled }),
      updatedAt: now,
    };
    mockUserAiConfigs[idx] = updated;
    return HttpResponse.json({ code: 0, message: '更新成功', data: updated });
  }),

  // DELETE /api/ai/user-configs/:id
  http.delete('/api/ai/user-configs/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockUserAiConfigs.findIndex((c) => c.id === id);
    if (idx < 0) return HttpResponse.json({ code: 404, message: '配置不存在', data: null }, { status: 404 });
    mockUserAiConfigs.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
