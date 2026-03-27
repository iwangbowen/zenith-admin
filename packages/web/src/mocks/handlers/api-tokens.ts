import { http, HttpResponse } from 'msw';
import type { UserApiToken, UserApiTokenCreated } from '@zenith/shared';

type TokenEntry = UserApiToken & { _full: string };

const mockTokenStore: TokenEntry[] = [
  {
    id: 1,
    name: '本地开发环境',
    tokenPrefix: 'zat_localdev01...',
    _full: 'zat_localdev0137f82c9b4e5a',
    lastUsedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    expiresAt: null,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 2,
    name: 'CI/CD Pipeline',
    tokenPrefix: 'zat_cicd00x002...',
    _full: 'zat_cicd00x002a9b7fe3c81d',
    lastUsedAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
    createdAt: '2024-04-15T08:00:00.000Z',
  },
];

let nextId = 3;

export const apiTokensHandlers = [
  // 获取 Token 列表（隐藏完整 token）
  http.get('/api/api-tokens', () => {
    const data: UserApiToken[] = mockTokenStore.map(({ _full: _, ...t }) => t);
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // 创建 Token（仅在此刻返回完整值）
  http.post('/api/api-tokens', async ({ request }) => {
    const body = await request.json() as { name?: string };
    if (!body.name?.trim()) {
      return HttpResponse.json({ code: 400, message: 'Token 名称不能为空', data: null });
    }
    if (mockTokenStore.length >= 20) {
      return HttpResponse.json({ code: 400, message: '最多只能创建 20 个 API Token', data: null });
    }
    const token = `zat_demo${Math.random().toString(36).slice(2).padEnd(20, '0').slice(0, 20)}`;
    const entry: TokenEntry = {
      id: nextId++,
      name: body.name.trim(),
      tokenPrefix: `${token.slice(0, 12)}...`,
      _full: token,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    };
    mockTokenStore.push(entry);
    const response: UserApiTokenCreated = {
      id: entry.id,
      name: entry.name,
      token,
      createdAt: entry.createdAt,
    };
    return HttpResponse.json({ code: 0, message: 'Token 已创建，请务必复制保存，此后将无法再次查看完整 Token', data: response });
  }),

  // 撤销 Token
  http.delete('/api/api-tokens/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockTokenStore.findIndex((t) => t.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: 'Token 不存在', data: null });
    mockTokenStore.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: 'Token 已撤销', data: null });
  }),
];
