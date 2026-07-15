/**
 * OAuth2 服务端相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

// ─── OAuth2 应用（客户端）DTOs ────────────────────────────────────────────────

export const OAuth2ClientListItemDTO = z
  .object({
    id: z.number().int(),
    clientId: z.string(),
    clientSecretPrefix: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    logoUrl: z.string().nullable(),
    redirectUris: z.array(z.string()),
    allowedScopes: z.array(z.string()),
    grantTypes: z.array(z.string()),
    isPublic: z.boolean(),
    ratePlanId: z.number().int().nullable(),
    signEnabled: z.boolean(),
    ipAllowlist: z.array(z.string()),
    status: z.enum(['enabled', 'disabled']),
    ownerId: z.number().int().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('OAuth2ClientListItem');

/** 创建应用时一次性返回，包含明文 clientSecret */
export const OAuth2ClientCreatedDTO = z
  .object({
    id: z.number().int(),
    clientId: z.string(),
    clientSecret: z.string(),
    name: z.string(),
    redirectUris: z.array(z.string()),
    allowedScopes: z.array(z.string()),
    grantTypes: z.array(z.string()),
    isPublic: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    createdAt: z.string(),
  })
  .openapi('OAuth2ClientCreated');

/** 重置 secret 时一次性返回新的明文 secret */
export const OAuth2ClientSecretDTO = z
  .object({
    clientId: z.string(),
    clientSecret: z.string(),
  })
  .openapi('OAuth2ClientSecret');

// ─── OAuth2 令牌 DTO ─────────────────────────────────────────────────────────

export const OAuth2AppOptionDTO = z
  .object({
    clientId: z.string(),
    name: z.string(),
  })
  .openapi('OAuth2AppOption');

export const OAuth2TokenListItemDTO = z
  .object({
    id: z.number().int(),
    tokenType: z.enum(['access', 'refresh']),
    tokenPrefix: z.string().nullable(),
    clientId: z.string(),
    userId: z.number().int().nullable(),
    scopes: z.array(z.string()),
    expiresAt: z.string().nullable(),
    revoked: z.boolean(),
    createdAt: z.string(),
  })
  .openapi('OAuth2TokenListItem');

// ─── OAuth2 授权端点 DTOs ────────────────────────────────────────────────────

/** /api/oauth2/authorize/info 响应 */
export const OAuth2AuthorizeInfoDTO = z
  .object({
    clientId: z.string(),
    name: z.string(),
    logoUrl: z.string().nullable(),
    description: z.string().nullable(),
    requestedScopes: z.array(z.string()),
    alreadyGranted: z.boolean(),
  })
  .openapi('OAuth2AuthorizeInfo');

/** /api/oauth2/token 响应（标准 OAuth2 格式）*/
export const OAuth2TokenResponseDTO = z
  .object({
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int(),
    refresh_token: z.string().optional(),
    scope: z.string(),
  })
  .openapi('OAuth2TokenResponse');

/** /api/oauth2/userinfo 响应 */
export const OAuth2UserInfoDTO = z
  .object({
    sub: z.string(),
    name: z.string().optional(),
    nickname: z.string().optional(),
    picture: z.string().optional(),
    email: z.string().optional(),
    email_verified: z.boolean().optional(),
  })
  .openapi('OAuth2UserInfo');

/** /api/oauth2/token/introspect 响应 */
export const OAuth2IntrospectResponseDTO = z
  .object({
    active: z.boolean(),
    scope: z.string().optional(),
    client_id: z.string().optional(),
    username: z.string().optional(),
    exp: z.number().int().optional(),
    iat: z.number().int().optional(),
    sub: z.string().optional(),
    token_type: z.string().optional(),
  })
  .openapi('OAuth2IntrospectResponse');
