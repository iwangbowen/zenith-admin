import { http, HttpResponse } from 'msw';
import type { OAuth2Client, OAuth2ClientCreated } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

const BASE = '/api/developer-apps';
let nextId = 102;
let apps: OAuth2Client[] = [{
  id: 101,
  clientId: 'sandbox-demo-developer-app',
  clientSecretPrefix: 'oas_demo...',
  name: '我的沙箱应用',
  description: '用于体验开放平台自助接入流程',
  logoUrl: null,
  redirectUris: ['https://example.com/oauth/callback'],
  allowedScopes: ['openid', 'profile', 'data:read'],
  grantTypes: ['authorization_code', 'refresh_token'],
  isPublic: false,
  ratePlanId: 1,
  signEnabled: true,
  ipAllowlist: [],
  environment: 'sandbox',
  reviewStatus: 'draft',
  reviewComment: null,
  submittedAt: null,
  reviewedAt: null,
  reviewedBy: null,
  previousSecretExpiresAt: null,
  status: 'enabled',
  ownerId: 1,
  createdAt: '2026-07-15 10:00:00',
  updatedAt: '2026-07-15 10:00:00',
}];

const ok = (data: unknown, message = 'success') => HttpResponse.json({ code: 0, message, data });
const notFound = () => HttpResponse.json({ code: 404, message: '应用不存在', data: null }, { status: 404 });
const secret = () => `oas_mock_${Math.random().toString(36).slice(2)}${Date.now()}`;

export const developerAppsHandlers = [
  http.get(BASE, ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const environment = url.searchParams.get('environment');
    const reviewStatus = url.searchParams.get('reviewStatus');
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const filtered = apps.filter((app) =>
      (!keyword || app.name.includes(keyword))
      && (!environment || app.environment === environment)
      && (!reviewStatus || app.reviewStatus === reviewStatus),
    );
    const start = (page - 1) * pageSize;
    return ok({ list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
  }),
  http.post(BASE, async ({ request }) => {
    const body = await request.json() as Partial<OAuth2Client>;
    const rawSecret = secret();
    const now = mockDateTime();
    const app: OAuth2Client = {
      id: nextId++,
      clientId: `dev-${Date.now()}`,
      clientSecretPrefix: body.isPublic ? null : `${rawSecret.slice(0, 10)}...`,
      name: body.name ?? '未命名应用',
      description: body.description ?? null,
      logoUrl: body.logoUrl ?? null,
      redirectUris: body.redirectUris ?? [],
      allowedScopes: body.allowedScopes ?? ['openid'],
      grantTypes: body.grantTypes ?? ['authorization_code'],
      isPublic: body.isPublic ?? false,
      ratePlanId: body.ratePlanId ?? null,
      signEnabled: body.signEnabled ?? false,
      ipAllowlist: body.ipAllowlist ?? [],
      environment: body.environment ?? 'sandbox',
      reviewStatus: 'draft',
      reviewComment: null,
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      previousSecretExpiresAt: null,
      status: 'enabled',
      ownerId: 1,
      createdAt: now,
      updatedAt: now,
    };
    apps = [app, ...apps];
    const result: OAuth2ClientCreated = { ...app, clientSecret: body.isPublic ? '' : rawSecret };
    return ok(result, '应用已保存为草稿');
  }),
  http.post(`${BASE}/:id/submit`, ({ params }) => {
    const app = apps.find((item) => item.id === Number(params.id));
    if (!app) return notFound();
    app.reviewStatus = 'pending';
    app.submittedAt = mockDateTime();
    app.updatedAt = mockDateTime();
    return ok(app, '已提交审核');
  }),
  http.post(`${BASE}/:id/regenerate-secret`, ({ params }) => {
    const app = apps.find((item) => item.id === Number(params.id));
    if (!app) return notFound();
    const rawSecret = secret();
    app.clientSecretPrefix = `${rawSecret.slice(0, 10)}...`;
    app.previousSecretExpiresAt = '2026-07-16 10:00:00';
    return ok({
      clientId: app.clientId,
      clientSecret: rawSecret,
      previousValidUntil: app.previousSecretExpiresAt,
    });
  }),
  http.get(`${BASE}/:id/quota-usage`, ({ params }) => {
    const app = apps.find((item) => item.id === Number(params.id));
    if (!app) return notFound();
    const sandbox = app.environment === 'sandbox';
    return ok({
      clientId: app.clientId,
      environment: app.environment,
      planCode: 'free',
      planName: '免费版',
      qps: { used: sandbox ? 0 : 2, limit: sandbox ? 0 : 5, percentage: sandbox ? 0 : 40 },
      daily: { used: sandbox ? 0 : 8120, limit: sandbox ? 0 : 10000, percentage: sandbox ? 0 : 81.2 },
      monthly: { used: sandbox ? 0 : 56000, limit: sandbox ? 0 : 200000, percentage: sandbox ? 0 : 28 },
    });
  }),
  http.post(`${BASE}/:id/debug`, async ({ params, request }) => {
    const app = apps.find((item) => item.id === Number(params.id));
    if (!app) return notFound();
    const body = await request.json() as { method: string; path: string; query?: Record<string, string>; body?: unknown };
    const qs = new URLSearchParams(body.query ?? {}).toString();
    return ok({
      requestUrl: `http://127.0.0.1:3300${body.path}${qs ? `?${qs}` : ''}`,
      method: body.method,
      requestHeaders: {
        'X-App-Key': app.clientId,
        'X-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Nonce': 'mock-nonce',
        'X-Signature': 'mock-signature',
      },
      stringToSign: `${body.method}\n${body.path}\n${qs}\n...\nmock-body-hash`,
      statusCode: 200,
      responseHeaders: { 'content-type': 'application/json', 'x-zenith-environment': app.environment },
      responseBody: JSON.stringify({ code: 0, message: 'success', data: body.body ?? body.query ?? { pong: true } }),
      durationMs: 23,
    });
  }),
  http.get(`${BASE}/:id`, ({ params }) => {
    const app = apps.find((item) => item.id === Number(params.id));
    return app ? ok(app) : notFound();
  }),
  http.put(`${BASE}/:id`, async ({ params, request }) => {
    const index = apps.findIndex((item) => item.id === Number(params.id));
    if (index < 0) return notFound();
    const body = await request.json() as Partial<OAuth2Client>;
    apps[index] = {
      ...apps[index],
      ...body,
      id: apps[index].id,
      clientId: apps[index].clientId,
      reviewStatus: 'draft',
      reviewComment: null,
      updatedAt: mockDateTime(),
    };
    return ok(apps[index], '更新成功');
  }),
  http.delete(`${BASE}/:id`, ({ params }) => {
    const before = apps.length;
    apps = apps.filter((item) => item.id !== Number(params.id));
    return apps.length < before ? ok(null, '删除成功') : notFound();
  }),
];
