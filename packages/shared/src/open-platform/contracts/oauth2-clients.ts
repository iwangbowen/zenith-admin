import * as z from 'zod';
import { auditFieldsSchema, entityStatusSchema, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { OAUTH2_TOKEN_TYPES, OPEN_APP_ENVIRONMENTS, OPEN_APP_REVIEW_STATUSES } from '../constants';
import { createOAuth2ClientSchema, reviewOAuth2ClientSchema, updateOAuth2ClientSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** OAuth2 应用（客户端）；管理端与开发者中心共用同一实体形状 */
export const oauth2ClientSchema = z.object({
  id: z.int(),
  clientId: z.string().meta({ description: 'client_id（UUID），同时作为开放 API 的 AppKey' }),
  clientSecretPrefix: z.string().nullable().meta({ description: 'secret 前缀（列表展示）；公开客户端为 null' }),
  name: z.string(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  redirectUris: z.array(z.string()),
  allowedScopes: z.array(z.string()),
  grantTypes: z.array(z.string()),
  isPublic: z.boolean().meta({ description: '公开客户端（无 secret，必须使用 PKCE）' }),
  ratePlanId: z.int().nullable().meta({ description: '绑定的限流套餐；null = 使用默认套餐' }),
  signEnabled: z.boolean().meta({ description: '调用开放 API 时是否可用 AppKey + HMAC 签名通道' }),
  ipAllowlist: z.array(z.string()).meta({ description: '来源 IP / CIDR 白名单；空数组表示不限制' }),
  environment: z.enum(OPEN_APP_ENVIRONMENTS),
  reviewStatus: z.enum(OPEN_APP_REVIEW_STATUSES),
  reviewComment: z.string().nullable(),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewedBy: z.int().nullable(),
  previousSecretExpiresAt: z.string().nullable().meta({ description: '轮换后旧密钥的失效时间' }),
  status: entityStatusSchema,
  ownerId: z.int().nullable(),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'OAuth2Client' });

export type OAuth2Client = z.infer<typeof oauth2ClientSchema>;

/** 创建应用时一次性返回，包含明文 secret（公开客户端为空串） */
export const oauth2ClientCreatedSchema = oauth2ClientSchema.extend({
  clientSecret: z.string(),
}).meta({ id: 'OAuth2ClientCreated' });

export type OAuth2ClientCreated = z.infer<typeof oauth2ClientCreatedSchema>;

/** 重置 / 轮换 secret 时一次性返回新的明文 secret */
export const oauth2ClientSecretSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  previousValidUntil: z.string().meta({ description: '旧密钥在宽限期内的有效期至' }),
}).meta({ id: 'OAuth2ClientSecret' });

export type OAuth2ClientSecret = z.infer<typeof oauth2ClientSecretSchema>;

/** 启用应用的轻量选项（供 Webhook / SDK / 统计筛选下拉） */
export const oauth2AppOptionSchema = z.object({
  id: z.int(),
  clientId: z.string(),
  name: z.string(),
  environment: z.enum(OPEN_APP_ENVIRONMENTS),
  reviewStatus: z.enum(OPEN_APP_REVIEW_STATUSES),
  isPublic: z.boolean(),
  signEnabled: z.boolean(),
}).meta({ id: 'OAuth2AppOption' });

export type OAuth2AppOption = z.infer<typeof oauth2AppOptionSchema>;

/** 已颁发令牌（前缀脱敏） */
export const oauth2TokenSchema = z.object({
  id: z.int(),
  tokenType: z.enum(OAUTH2_TOKEN_TYPES),
  tokenPrefix: z.string().nullable(),
  clientId: z.string(),
  userId: z.int().nullable().meta({ description: 'client_credentials 颁发的令牌为 null' }),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable(),
  revoked: z.boolean(),
  createdAt: z.string(),
}).meta({ id: 'OAuth2Token' });

export type OAuth2Token = z.infer<typeof oauth2TokenSchema>;

/** 用户对应用的授权记录（管理端视角） */
export const oauth2UserGrantSchema = z.object({
  id: z.int(),
  userId: z.int(),
  username: z.string().nullable(),
  nickname: z.string().nullable(),
  clientId: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'OAuth2UserGrant' });

export type OAuth2UserGrant = z.infer<typeof oauth2UserGrantSchema>;

/** 「我的已授权应用」条目（用户视角，含应用展示信息） */
export const oauth2MyGrantSchema = z.object({
  id: z.int(),
  clientId: z.string(),
  appName: z.string(),
  appLogoUrl: z.string().nullable(),
  appDescription: z.string().nullable(),
  environment: z.enum(OPEN_APP_ENVIRONMENTS),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'OAuth2MyGrant' });

export type OAuth2MyGrant = z.infer<typeof oauth2MyGrantSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

/** 应用列表筛选（管理端与开发者中心共用） */
export const oauth2ClientListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按应用名称模糊匹配' }),
  environment: queryEnum(OPEN_APP_ENVIRONMENTS),
  reviewStatus: queryEnum(OPEN_APP_REVIEW_STATUSES),
});

export const oauth2TokenListQuery = paginationQuery.extend({
  clientId: z.string().meta({ description: '应用 client_id' }),
});

export const oauth2ClientContract = defineContract('/api/oauth2/clients', {
  list: op.get('/', { query: oauth2ClientListQuery, response: paginated(oauth2ClientSchema), summary: '获取 OAuth2 应用列表' }),
  options: op.get('/options', { response: z.array(oauth2AppOptionSchema), summary: '获取启用应用的选项列表（供 Webhook/SDK 下拉）' }),
  tokens: op.get('/tokens', { query: oauth2TokenListQuery, response: paginated(oauth2TokenSchema), summary: '获取应用令牌列表' }),
  revokeToken: op.delete('/tokens/{id}', { params: idParam, summary: '撤销令牌' }),
  myGrants: op.get('/my-grants', { query: paginationQuery, response: paginated(oauth2MyGrantSchema), summary: '获取我已授权的第三方应用' }),
  revokeMyGrant: op.delete('/my-grants/{id}', { params: idParam, summary: '撤销我对某个应用的授权' }),
  create: op.post('/', {
    body: createOAuth2ClientSchema,
    response: oauth2ClientCreatedSchema,
    summary: '创建 OAuth2 应用（clientSecret 仅在此返回一次）',
  }),
  grants: op.get('/{id}/grants', {
    params: idParam,
    query: paginationQuery,
    response: paginated(oauth2UserGrantSchema),
    summary: '获取应用的用户授权记录',
  }),
  review: op.post('/{id}/review', { params: idParam, body: reviewOAuth2ClientSchema, response: oauth2ClientSchema, summary: '审核开发者应用' }),
  detail: op.get('/{id}', { params: idParam, response: oauth2ClientSchema, summary: '获取 OAuth2 应用详情' }),
  update: op.put('/{id}', { params: idParam, body: updateOAuth2ClientSchema, response: oauth2ClientSchema, summary: '更新 OAuth2 应用' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除 OAuth2 应用' }),
  regenerateSecret: op.post('/{id}/regenerate-secret', {
    params: idParam,
    response: oauth2ClientSecretSchema,
    summary: '重置 OAuth2 应用的 client_secret（仅返回一次）',
  }),
}, { tags: ['OAuth2Apps'] });
