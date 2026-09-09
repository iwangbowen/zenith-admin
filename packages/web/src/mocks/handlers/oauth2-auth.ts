/**
 * OAuth2 端点 Mock：授权同意页的两个业务信封端点由契约绑定；
 * /token、/token/revoke、/token/introspect、/userinfo 是 RFC 协议端点（表单入参 + 顶层响应），保持 http.* 声明。
 */
import { http, HttpResponse } from 'msw';
import { oauth2AuthContract, OAUTH2_SCOPE_DESCRIPTIONS } from '@zenith/shared/open-platform';
import { readFormOrJsonBody } from '@/mocks/utils/body';
import { mock } from '@/mocks/utils/contract';
import { ok } from '@/mocks/utils/handlers';
const BASE = oauth2AuthContract.basePath;

// 简单的 mock token store
const accessTokens = new Map<string, { userId: number; clientId: string; scopes: string[] }>();

export const oauth2AuthHandlers = [
  // 查询应用授权信息
  mock(oauth2AuthContract.authorizeInfo, ({ query, ok }) => {
    const requestedScopes = query.scope.split(' ').filter(Boolean);
    return ok({
      clientId: query.client_id,
      name: 'Demo 应用（Mock）',
      logoUrl: null,
      description: '这是一个演示应用',
      requestedScopes,
      scopeDetails: requestedScopes.map((code) => ({
        code,
        name: code,
        description: OAUTH2_SCOPE_DESCRIPTIONS[code] ?? null,
        granted: false,
      })),
      alreadyGranted: false,
      requiresPkce: true,
    });
  }),

  // 用户确认授权
  mock(oauth2AuthContract.authorize, ({ body, ok }) => {
    const code = `mock_code_${Date.now()}`;
    // mock 不需要真正存储 code，直接返回跳转 URL
    const stateParam = body.state ? `&state=${encodeURIComponent(body.state)}` : '';
    return ok({ redirectUrl: `${body.redirect_uri}?code=${code}${stateParam}` });
  }),

  // 令牌端点（form-urlencoded，mock 接受 JSON 也行）
  http.post(`${BASE}/token`, async ({ request: req }) => {
    const body = await readFormOrJsonBody(req);
    const grantType = body.grant_type;
    if (grantType === 'authorization_code' || grantType === 'client_credentials') {
      const token = `oat_mock_${Date.now()}`;
      accessTokens.set(token, { userId: 1, clientId: body.client_id ?? '', scopes: ['openid', 'profile'] });
      return HttpResponse.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 7200,
        refresh_token: `ort_mock_${Date.now()}`,
        scope: body.scope ?? 'openid',
      });
    }
    return HttpResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }),

  // 令牌撤销
  http.post(`${BASE}/token/revoke`, async ({ request: req }) => {
    if (req.headers.has('content-type') || req.headers.has('content-length')) {
      await readFormOrJsonBody(req);
    }
    return ok(null, '已撤销');
  }),

  // 令牌自省
  http.post(`${BASE}/token/introspect`, async ({ request: req }) => {
    const body = await readFormOrJsonBody(req);
    const token = body.token ?? '';
    const info = accessTokens.get(token);
    if (!info) {
      return HttpResponse.json({ active: false });
    }
    return HttpResponse.json({
      active: true,
      scope: info.scopes.join(' '),
      client_id: info.clientId,
      username: 'admin',
      sub: String(info.userId),
      token_type: 'access',
    });
  }),

  // UserInfo
  http.get(`${BASE}/userinfo`, () => {
    return HttpResponse.json({
      sub: '1',
      name: 'Super Admin',
      nickname: 'admin',
      email: 'admin@zenith.com',
      email_verified: true,
    });
  }),
];
