import { http, HttpResponse } from 'msw';
import type { UserAiConfig } from '@zenith/shared';
import { mockDateTime } from '../utils/date';

let mockUserAiConfig: UserAiConfig | null = null;

export const userAiConfigHandlers = [
  // GET /api/ai/user-config
  http.get('/api/ai/user-config', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: mockUserAiConfig });
  }),

  // PUT /api/ai/user-config
  http.put('/api/ai/user-config', async ({ request }) => {
    const body = await request.json() as Partial<UserAiConfig>;
    const now = mockDateTime();
    mockUserAiConfig = {
      id: mockUserAiConfig?.id ?? 1,
      userId: 1,
      provider: body.provider ?? 'openai_compatible',
      baseUrl: body.baseUrl ?? null,
      apiKey: body.apiKey ? '***' : (mockUserAiConfig?.apiKey ?? null),
      model: body.model ?? null,
      isEnabled: body.isEnabled ?? true,
      createdAt: mockUserAiConfig?.createdAt ?? now,
      updatedAt: now,
    };
    return HttpResponse.json({ code: 0, message: '保存成功', data: mockUserAiConfig });
  }),
];
