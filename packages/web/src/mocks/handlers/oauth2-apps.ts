import { http, HttpResponse } from 'msw';
import type { OAuth2Client, OAuth2ClientCreated } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

type ClientEntry = OAuth2Client;

let nextId = 1;

const mockClients: ClientEntry[] = [
  {
    id: nextId++,
    clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    clientSecretPrefix: 'oas_demoapp1...',
    name: '示例应用（授权码模式）',
    description: '用于演示 authorization_code + PKCE 流程',
    logoUrl: null,
    redirectUris: ['https://demo-app.example.com/callback'],
    allowedScopes: ['openid', 'profile', 'email'],
    grantTypes: ['authorization_code', 'refresh_token'],
    isPublic: false,
    ratePlanId: 2,
    signEnabled: true,
    ipAllowlist: [],
    status: 'enabled',
    ownerId: 1,
    createdAt: '2024-06-01 10:00:00',
    updatedAt: '2024-06-01 10:00:00',
  },
  {
    id: nextId++,
    clientId: 'f0e1d2c3-b4a5-6789-0abc-de1234567891',
    clientSecretPrefix: 'oas_svcapp001...',
    name: '内部服务（客户端凭证）',
    description: '用于后端服务间调用，无用户上下文',
    logoUrl: null,
    redirectUris: [],
    allowedScopes: ['profile'],
    grantTypes: ['client_credentials'],
    isPublic: false,
    ratePlanId: 3,
    signEnabled: true,
    ipAllowlist: ['10.0.0.0/8'],
    status: 'enabled',
    ownerId: 1,
    createdAt: '2024-06-02 09:00:00',
    updatedAt: '2024-06-02 09:00:00',
  },
  {
    id: nextId++,
    clientId: 'c0ffee00-1234-5678-9abc-def012345678',
    clientSecretPrefix: null,
    name: '移动端公开客户端',
    description: '原生 App，使用 PKCE 无 secret',
    logoUrl: null,
    redirectUris: ['myapp://oauth/callback'],
    allowedScopes: ['openid', 'profile', 'email', 'offline_access'],
    grantTypes: ['authorization_code', 'refresh_token'],
    isPublic: true,
    ratePlanId: 1,
    signEnabled: false,
    ipAllowlist: [],
    status: 'enabled',
    ownerId: 1,
    createdAt: '2024-06-03 08:00:00',
    updatedAt: '2024-06-03 08:00:00',
  },
];

const BASE = '/api/oauth2/clients';

export const oauth2AppsHandlers = [
  // 列表
  http.get(BASE, ({ request: req }) => {
    const url = new URL(req.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const filtered = keyword
      ? mockClients.filter((c) => c.name.includes(keyword))
      : mockClients;
    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: { list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize },
    });
  }),

  // 应用选项（供 Webhook/SDK 下拉）
  http.get(`${BASE}/options`, () => {
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: mockClients.filter((c) => c.status === 'enabled').map((c) => ({ clientId: c.clientId, name: c.name })),
    });
  }),

  http.get(`${BASE}/tokens`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    return HttpResponse.json({ code: 0, message: 'success', data: { list: [], total: 0, page, pageSize } });
  }),

  http.delete(`${BASE}/tokens/:id`, () => {
    return HttpResponse.json({ code: 0, message: '令牌已撤销', data: null });
  }),

  http.get(`${BASE}/:id/grants`, ({ params, request }) => {
    const client = mockClients.find((item) => item.id === Number(params.id));
    if (!client) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    const list = [{
      id: 1,
      userId: 1,
      username: 'admin',
      nickname: '系统管理员',
      clientId: client.clientId,
      scopes: client.allowedScopes.slice(0, 2),
      createdAt: '2026-06-01 10:00:00',
      updatedAt: '2026-06-01 10:00:00',
    }];
    return HttpResponse.json({ code: 0, message: 'success', data: { list, total: list.length, page, pageSize } });
  }),

  // 创建
  http.post(BASE, async ({ request: req }) => {
    const body = await req.json() as Omit<OAuth2Client, 'id' | 'createdAt' | 'updatedAt' | 'clientId' | 'clientSecretPrefix' | 'ownerId'>;
    const clientId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const clientSecret = `oas_mock${randomHex(32)}`;
    const newClient: ClientEntry = {
      id: nextId++,
      clientId,
      clientSecretPrefix: body.isPublic ? null : `${clientSecret.slice(0, 10)}...`,
      name: body.name,
      description: body.description ?? null,
      logoUrl: body.logoUrl ?? null,
      redirectUris: body.redirectUris,
      allowedScopes: body.allowedScopes,
      grantTypes: body.grantTypes,
      isPublic: body.isPublic,
      ratePlanId: body.ratePlanId ?? null,
      signEnabled: body.signEnabled ?? false,
      ipAllowlist: body.ipAllowlist ?? [],
      status: 'enabled',
      ownerId: 1,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockClients.push(newClient);
    const result: OAuth2ClientCreated = { ...newClient, clientSecret: body.isPublic ? '' : clientSecret };
    return HttpResponse.json({ code: 0, message: '创建成功', data: result });
  }),

  // 详情
  http.get(`${BASE}/:id`, ({ params }) => {
    const found = mockClients.find((c) => c.id === Number(params.id));
    if (!found) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'success', data: found });
  }),

  // 更新
  http.put(`${BASE}/:id`, async ({ params, request: req }) => {
    const idx = mockClients.findIndex((c) => c.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    const body = await req.json() as Partial<OAuth2Client>;
    mockClients[idx] = { ...mockClients[idx], ...body, updatedAt: mockDateTime() };
    return HttpResponse.json({ code: 0, message: '更新成功', data: mockClients[idx] });
  }),

  // 删除
  http.delete(`${BASE}/:id`, ({ params }) => {
    const idx = mockClients.findIndex((c) => c.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    mockClients.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 重置 Secret
  http.post(`${BASE}/:id/regenerate-secret`, ({ params }) => {
    const found = mockClients.find((c) => c.id === Number(params.id));
    if (!found) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    const clientSecret = `oas_mock${randomHex(32)}`;
    found.clientSecretPrefix = `${clientSecret.slice(0, 10)}...`;
    return HttpResponse.json({ code: 0, message: 'secret 已重置', data: { clientId: found.clientId, clientSecret } });
  }),

];

function randomHex(len: number) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
