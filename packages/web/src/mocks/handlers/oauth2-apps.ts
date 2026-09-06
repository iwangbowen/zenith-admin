import { oauth2ClientContract } from '@zenith/shared/open-platform';
import type { OAuth2Client, OAuth2ClientCreated, OAuth2MyGrant, OAuth2Token, OAuth2UserGrant } from '@zenith/shared/open-platform';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

let nextId = 1;

export const mockOAuth2Clients: OAuth2Client[] = [
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
    environment: 'production',
    reviewStatus: 'approved',
    reviewComment: null,
    submittedAt: '2024-05-30 10:00:00',
    reviewedAt: '2024-05-31 10:00:00',
    reviewedBy: 1,
    previousSecretExpiresAt: null,
    status: 'enabled',
    ownerId: 1,
    tenantId: null,
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
    environment: 'production',
    reviewStatus: 'approved',
    reviewComment: null,
    submittedAt: '2024-06-01 10:00:00',
    reviewedAt: '2024-06-01 12:00:00',
    reviewedBy: 1,
    previousSecretExpiresAt: null,
    status: 'enabled',
    ownerId: 1,
    tenantId: null,
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
    environment: 'sandbox',
    reviewStatus: 'pending',
    reviewComment: null,
    submittedAt: '2024-06-03 09:00:00',
    reviewedAt: null,
    reviewedBy: null,
    previousSecretExpiresAt: null,
    status: 'enabled',
    ownerId: 1,
    tenantId: null,
    createdAt: '2024-06-03 08:00:00',
    updatedAt: '2024-06-03 08:00:00',
  },
  {
    id: nextId++,
    clientId: 'sandbox-pay-1234-5678-9abc-def012345678',
    clientSecretPrefix: 'oas_sandboxpay...',
    name: '沙箱支付服务',
    description: '用于支付宝沙箱支付演示',
    logoUrl: null,
    redirectUris: [],
    allowedScopes: ['payment:intent:create', 'payment:intent:read'],
    grantTypes: ['client_credentials'],
    isPublic: false,
    ratePlanId: 1,
    signEnabled: true,
    ipAllowlist: [],
    environment: 'sandbox',
    reviewStatus: 'approved',
    reviewComment: null,
    submittedAt: '2024-06-03 10:00:00',
    reviewedAt: '2024-06-03 11:00:00',
    reviewedBy: 1,
    previousSecretExpiresAt: null,
    status: 'enabled',
    ownerId: 1,
    tenantId: null,
    createdAt: '2024-06-03 10:00:00',
    updatedAt: '2024-06-03 11:00:00',
  },
];

function randomHex(len: number) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/** 演示用的用户授权记录：管理员对前两个应用各授权一次 */
function grantsOf(client: OAuth2Client): OAuth2UserGrant[] {
  return [{
    id: 1,
    userId: 1,
    username: 'admin',
    nickname: '系统管理员',
    clientId: client.clientId,
    scopes: client.allowedScopes.slice(0, 2),
    createdAt: '2026-06-01 10:00:00',
    updatedAt: '2026-06-01 10:00:00',
  }];
}

export const oauth2AppsHandlers = [
  mock(oauth2ClientContract.list, ({ query, ok, paginate }) => {
    const filtered = mockOAuth2Clients.filter((client) =>
      includesKeyword(query.keyword, client.name)
      && (!query.environment || client.environment === query.environment)
      && (!query.reviewStatus || client.reviewStatus === query.reviewStatus),
    );
    return ok(paginate(filtered));
  }),

  // 应用选项（供 Webhook/SDK 下拉）
  mock(oauth2ClientContract.options, ({ ok }) => ok(mockOAuth2Clients.filter((c) => c.status === 'enabled').map((c) => ({
    id: c.id,
    clientId: c.clientId,
    name: c.name,
    environment: c.environment,
    reviewStatus: c.reviewStatus,
    isPublic: c.isPublic,
    signEnabled: c.signEnabled,
  })))),

  // 我的已授权应用（用户自助）
  mock(oauth2ClientContract.myGrants, ({ ok, paginate }) => {
    const list: OAuth2MyGrant[] = mockOAuth2Clients.slice(0, 2).map((client, index) => ({
      id: index + 1,
      clientId: client.clientId,
      appName: client.name,
      appLogoUrl: client.logoUrl,
      appDescription: client.description,
      environment: client.environment,
      scopes: client.allowedScopes.slice(0, 2),
      createdAt: '2026-06-01 10:00:00',
      updatedAt: '2026-06-01 10:00:00',
    }));
    return ok(paginate(list));
  }),

  mock(oauth2ClientContract.revokeMyGrant, ({ ok }) => ok(null, '授权已撤销')),

  mock(oauth2ClientContract.tokens, ({ ok, paginate }) => ok(paginate([] as OAuth2Token[]))),

  mock(oauth2ClientContract.revokeToken, ({ ok }) => ok(null, '令牌已撤销')),

  mock(oauth2ClientContract.grants, ({ params, ok, paginate }) => {
    const client = mockOAuth2Clients.find((item) => item.id === params.id);
    if (!client) return notFound('不存在', { status: 404 });
    return ok(paginate(grantsOf(client)));
  }),

  mock(oauth2ClientContract.create, ({ body, ok }) => {
    const clientId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const clientSecret = `oas_mock${randomHex(32)}`;
    const now = mockDateTime();
    const newClient: OAuth2Client = {
      id: nextId++,
      clientId,
      clientSecretPrefix: body.isPublic ? null : `${clientSecret.slice(0, 10)}...`,
      name: body.name,
      description: body.description ?? null,
      logoUrl: body.logoUrl || null,
      redirectUris: body.redirectUris,
      allowedScopes: body.allowedScopes,
      grantTypes: body.grantTypes,
      isPublic: body.isPublic,
      ratePlanId: body.ratePlanId ?? null,
      signEnabled: body.signEnabled ?? false,
      ipAllowlist: body.ipAllowlist,
      environment: body.environment,
      reviewStatus: 'approved',
      reviewComment: null,
      submittedAt: null,
      reviewedAt: now,
      reviewedBy: 1,
      previousSecretExpiresAt: null,
      status: 'enabled',
      ownerId: 1,
      tenantId: null,
      createdAt: now,
      updatedAt: now,
    };
    mockOAuth2Clients.push(newClient);
    const result: OAuth2ClientCreated = { ...newClient, clientSecret: body.isPublic ? '' : clientSecret };
    return ok(result, '创建成功');
  }),

  mock(oauth2ClientContract.detail, ({ params, ok }) => {
    const found = mockOAuth2Clients.find((c) => c.id === params.id);
    return found ? ok(found) : notFound('不存在', { status: 404 });
  }),

  mock(oauth2ClientContract.update, ({ params, body, ok }) => {
    const idx = mockOAuth2Clients.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('不存在', { status: 404 });
    const { logoUrl, ...rest } = body;
    mockOAuth2Clients[idx] = {
      ...mockOAuth2Clients[idx],
      ...rest,
      ...(logoUrl === undefined ? {} : { logoUrl: logoUrl || null }),
      updatedAt: mockDateTime(),
    };
    return ok(mockOAuth2Clients[idx], '更新成功');
  }),

  mock(oauth2ClientContract.remove, ({ params, ok }) => {
    const idx = mockOAuth2Clients.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('不存在', { status: 404 });
    mockOAuth2Clients.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  mock(oauth2ClientContract.regenerateSecret, ({ params, ok }) => {
    const found = mockOAuth2Clients.find((c) => c.id === params.id);
    if (!found) return notFound('不存在', { status: 404 });
    const clientSecret = `oas_mock${randomHex(32)}`;
    found.clientSecretPrefix = `${clientSecret.slice(0, 10)}...`;
    found.previousSecretExpiresAt = '2026-07-16 10:00:00';
    return ok({ clientId: found.clientId, clientSecret, previousValidUntil: found.previousSecretExpiresAt }, 'secret 已重置');
  }),

  mock(oauth2ClientContract.review, ({ params, body, ok }) => {
    const found = mockOAuth2Clients.find((client) => client.id === params.id);
    if (!found) return notFound('不存在', { status: 404 });
    found.reviewStatus = body.action === 'approve' ? 'approved' : 'rejected';
    found.reviewComment = body.comment ?? null;
    found.reviewedAt = mockDateTime();
    found.reviewedBy = 1;
    return ok(found, '审核完成');
  }),
];
