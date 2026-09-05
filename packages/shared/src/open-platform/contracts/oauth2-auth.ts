import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { oauth2AuthorizeSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 授权同意页所需的应用信息 */
export const oauth2AuthorizeInfoSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  description: z.string().nullable(),
  requestedScopes: z.array(z.string()),
  scopeDetails: z.array(z.object({
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    granted: z.boolean().meta({ description: '当前用户此前是否已授予该 scope' }),
  })).meta({ description: '每个申请 scope 的展示信息（取自 API Scope 表，缺失时回退到编码本身）' }),
  alreadyGranted: z.boolean().meta({ description: '申请的全部 scope 此前均已授予' }),
  requiresPkce: z.boolean().meta({ description: '授权端点是否强制 PKCE' }),
}).meta({ id: 'OAuth2AuthorizeInfo' });

export type OAuth2AuthorizeInfo = z.infer<typeof oauth2AuthorizeInfoSchema>;

/** 用户确认授权后的跳转地址（携带授权码与 state） */
export const oauth2AuthorizeResponseSchema = z.object({
  redirectUrl: z.string(),
}).meta({ id: 'OAuth2AuthorizeResponse' });

export type OAuth2AuthorizeResponse = z.infer<typeof oauth2AuthorizeResponseSchema>;

// ─── RFC 协议端点的响应形状（顶层格式，无业务信封） ───────────────────────────
// /token、/token/revoke、/token/introspect、/userinfo 以 application/x-www-form-urlencoded
// 入参并按 RFC 返回顶层 JSON，不经契约 DSL；这里只固定其响应 schema 供服务端文档引用。

/** 令牌端点响应（RFC 6749） */
export const oauth2TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.int(),
  refresh_token: z.string().optional(),
  scope: z.string(),
}).meta({ id: 'OAuth2TokenResponse' });

export type OAuth2TokenResponse = z.infer<typeof oauth2TokenResponseSchema>;

/** UserInfo 端点响应（OIDC Core 标准 claims） */
export const oauth2UserInfoSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  nickname: z.string().optional(),
  picture: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
}).meta({ id: 'OAuth2UserInfo' });

export type OAuth2UserInfo = z.infer<typeof oauth2UserInfoSchema>;

/** 令牌自省端点响应（RFC 7662） */
export const oauth2IntrospectResponseSchema = z.object({
  active: z.boolean(),
  scope: z.string().optional(),
  client_id: z.string().optional(),
  username: z.string().optional(),
  exp: z.int().optional(),
  iat: z.int().optional(),
  sub: z.string().optional(),
  token_type: z.string().optional(),
}).meta({ id: 'OAuth2IntrospectResponse' });

export type OAuth2IntrospectResponse = z.infer<typeof oauth2IntrospectResponseSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

/** 授权同意页查询参数；字段名沿用 RFC 6749 的下划线命名 */
export const oauth2AuthorizeInfoQuery = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  response_type: z.string(),
  scope: z.string(),
  state: z.string().optional(),
});

export const oauth2AuthContract = defineContract('/api/oauth2', {
  authorizeInfo: op.get('/authorize/info', {
    query: oauth2AuthorizeInfoQuery,
    response: oauth2AuthorizeInfoSchema,
    summary: '获取 OAuth2 应用授权信息（供同意页面展示）',
  }),
  authorize: op.post('/authorize', {
    body: oauth2AuthorizeSchema,
    response: oauth2AuthorizeResponseSchema,
    summary: '用户确认授权（OAuth 2.1 授权码模式）',
  }),
}, { tags: ['OAuth2'] });
