import { openCmsContract } from '@zenith/shared/cms';
import { developerAppContract, openGatewayContract } from '@zenith/shared/open-platform';
import type { OAuth2Client, OAuth2ClientCreated, OpenApiDebugEndpoint } from '@zenith/shared/open-platform';
import { urlOf } from '@/lib/contract-query';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';

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
  tenantId: null,
  createdAt: '2026-07-15 10:00:00',
  updatedAt: '2026-07-15 10:00:00',
}];
const secret = () => `oas_mock_${Math.random().toString(36).slice(2)}${Date.now()}`;

/** 端点目录：网关核心端点与演示用的两条 CMS 端点均取自契约 */
const DEBUG_ENDPOINTS: OpenApiDebugEndpoint[] = [
  { method: 'GET', path: urlOf(openGatewayContract.ping), summary: openGatewayContract.ping.summary, scope: null },
  { method: 'GET', path: urlOf(openGatewayContract.echoQuery), summary: openGatewayContract.echoQuery.summary, scope: 'data:read' },
  { method: 'POST', path: urlOf(openGatewayContract.echoBody), summary: openGatewayContract.echoBody.summary, scope: 'data:write' },
  { method: 'GET', path: urlOf(openGatewayContract.userinfo), summary: openGatewayContract.userinfo.summary, scope: 'user:read' },
  { method: 'GET', path: openCmsContract.channels.fullPath, summary: openCmsContract.channels.summary, scope: null },
  { method: 'GET', path: openCmsContract.contents.fullPath, summary: openCmsContract.contents.summary, scope: null },
];

export const developerAppsHandlers = [
  mock(developerAppContract.list, ({ query, ok, paginate }) => {
    const filtered = apps.filter((app) =>
      (!query.keyword || app.name.includes(query.keyword))
      && (!query.environment || app.environment === query.environment)
      && (!query.reviewStatus || app.reviewStatus === query.reviewStatus),
    );
    return ok(paginate(filtered));
  }),
  mock(developerAppContract.create, ({ body, ok }) => {
    const rawSecret = secret();
    const now = mockDateTime();
    const app: OAuth2Client = {
      id: nextId++,
      clientId: `dev-${Date.now()}`,
      clientSecretPrefix: body.isPublic ? null : `${rawSecret.slice(0, 10)}...`,
      name: body.name,
      description: body.description ?? null,
      logoUrl: body.logoUrl || null,
      redirectUris: body.redirectUris,
      allowedScopes: body.allowedScopes,
      grantTypes: body.grantTypes,
      isPublic: body.isPublic,
      ratePlanId: null,
      signEnabled: body.signEnabled ?? false,
      ipAllowlist: body.ipAllowlist,
      environment: body.environment,
      reviewStatus: 'draft',
      reviewComment: null,
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      previousSecretExpiresAt: null,
      status: 'enabled',
      ownerId: 1,
      tenantId: null,
      createdAt: now,
      updatedAt: now,
    };
    apps = [app, ...apps];
    const result: OAuth2ClientCreated = { ...app, clientSecret: body.isPublic ? '' : rawSecret };
    return ok(result, '应用已保存为草稿');
  }),
  mock(developerAppContract.submit, ({ params, ok }) => {
    const app = apps.find((item) => item.id === params.id);
    if (!app) return notFound('应用不存在', { status: 404 });
    app.reviewStatus = 'pending';
    app.submittedAt = mockDateTime();
    app.updatedAt = mockDateTime();
    return ok(app, '已提交审核');
  }),
  mock(developerAppContract.regenerateSecret, ({ params, ok }) => {
    const app = apps.find((item) => item.id === params.id);
    if (!app) return notFound('应用不存在', { status: 404 });
    const rawSecret = secret();
    app.clientSecretPrefix = `${rawSecret.slice(0, 10)}...`;
    app.previousSecretExpiresAt = '2026-07-16 10:00:00';
    return ok({
      clientId: app.clientId,
      clientSecret: rawSecret,
      previousValidUntil: app.previousSecretExpiresAt,
    });
  }),
  mock(developerAppContract.quotaUsage, ({ params, ok }) => {
    const app = apps.find((item) => item.id === params.id);
    if (!app) return notFound('应用不存在', { status: 404 });
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
  mock(developerAppContract.debugEndpoints, ({ ok }) => ok(DEBUG_ENDPOINTS)),
  mock(developerAppContract.debug, ({ params, body, ok }) => {
    const app = apps.find((item) => item.id === params.id);
    if (!app) return notFound('应用不存在', { status: 404 });
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
  mock(developerAppContract.detail, ({ params, ok }) => {
    const app = apps.find((item) => item.id === params.id);
    return app ? ok(app) : notFound('应用不存在', { status: 404 });
  }),
  mock(developerAppContract.update, ({ params, body, ok }) => {
    const index = apps.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('应用不存在', { status: 404 });
    const { logoUrl, ...rest } = body;
    apps[index] = {
      ...apps[index],
      ...rest,
      ...(logoUrl === undefined ? {} : { logoUrl: logoUrl || null }),
      reviewStatus: 'draft',
      reviewComment: null,
      updatedAt: mockDateTime(),
    };
    return ok(apps[index], '更新成功');
  }),
  mock(developerAppContract.remove, ({ params, ok }) => {
    const before = apps.length;
    apps = apps.filter((item) => item.id !== params.id);
    return apps.length < before ? ok(null, '删除成功') : notFound('应用不存在', { status: 404 });
  }),
];
