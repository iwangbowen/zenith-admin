import { http, HttpResponse } from 'msw';
import { mockDateTime } from '@/mocks/utils/date';

const API = import.meta.env.VITE_API_BASE_URL || '';

const mockConfigs = [
  { id: 1, provider: 'github', clientId: '', clientSecret: '', agentId: null, corpId: null, enabled: false, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 2, provider: 'dingtalk', clientId: '', clientSecret: '', agentId: null, corpId: null, enabled: false, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 3, provider: 'wechat_work', clientId: '', clientSecret: '', agentId: null, corpId: null, enabled: false, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
];

export const oauthConfigHandlers = [
  http.get(`${API}/api/oauth-config`, () => {
    return HttpResponse.json({ code: 0, message: 'success', data: mockConfigs });
  }),

  http.put(`${API}/api/oauth-config/:provider`, async ({ params, request }) => {
    const provider = params.provider as string;
    const body = (await request.json()) as Record<string, unknown>;
    const idx = mockConfigs.findIndex((c) => c.provider === provider);
    if (idx >= 0) {
      Object.assign(mockConfigs[idx], body, { updatedAt: mockDateTime() });
    }
    return HttpResponse.json({ code: 0, message: '保存成功', data: mockConfigs[idx] ?? null });
  }),
];
