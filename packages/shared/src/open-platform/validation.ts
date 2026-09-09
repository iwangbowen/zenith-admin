import * as z from 'zod';
import { httpUrl, partialForUpdate } from '../core/validation';
import { isSafeOAuthRedirectUri } from '../identity/constants';
import { RULE_REF_KINDS } from '../rules/constants';
import { createShortLinkSchema } from '../short-link/validation';
import {
  OAUTH2_CODE_CHALLENGE_METHODS,
  OAUTH2_GRANT_TYPES,
  OAUTH2_REVIEW_ACTIONS,
  OPEN_API_DEBUG_METHODS,
  OPEN_APP_ENVIRONMENTS,
  OPEN_WEBHOOK_EVENTS,
} from './constants';
import { entityStatusSchema } from '../core/api-schemas';

const ipOrCidrSchema = z.string().min(2).max(64).regex(
  /^((\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)(\/\d{1,3})?$/,
  '请输入有效的 IP 地址或 CIDR',
);

const redirectUriSchema = z.string().min(1).max(500)
  .refine(isSafeOAuthRedirectUri, '回调 URL 仅允许 HTTPS、localhost HTTP 或安全的自定义协议');

const oauth2ClientFields = {
  name: z.string().trim().min(1).max(64),
  description: z.string().max(256).optional(),
  logoUrl: httpUrl().max(1024).optional().or(z.literal('')),
  redirectUris: z.array(redirectUriSchema).max(20),
  allowedScopes: z.array(z.string().min(1).max(64)).min(1),
  grantTypes: z.array(z.enum(OAUTH2_GRANT_TYPES)).min(1),
  isPublic: z.boolean(),
  ratePlanId: z.number().int().positive().nullable().optional(),
  signEnabled: z.boolean().optional(),
  ipAllowlist: z.array(ipOrCidrSchema).max(100),
  environment: z.enum(OPEN_APP_ENVIRONMENTS),
};

const oauth2ClientBaseSchema = z.object(oauth2ClientFields);

const oauth2ClientCreateSchema = z.object({
  ...oauth2ClientFields,
  ipAllowlist: oauth2ClientFields.ipAllowlist.default([]),
  environment: oauth2ClientFields.environment.default('production'),
});

function validateOAuth2Client(value: z.infer<typeof oauth2ClientCreateSchema>, ctx: z.RefinementCtx) {
  if (value.grantTypes.includes('authorization_code') && value.redirectUris.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['redirectUris'], message: '授权码模式至少需要一个回调 URL' });
  }
  if (value.isPublic && value.grantTypes.includes('client_credentials')) {
    ctx.addIssue({ code: 'custom', path: ['grantTypes'], message: '公开客户端不支持客户端凭证模式' });
  }
  if (value.grantTypes.includes('refresh_token') && !value.grantTypes.includes('authorization_code')) {
    ctx.addIssue({ code: 'custom', path: ['grantTypes'], message: '刷新令牌模式必须与授权码模式同时启用' });
  }
  if (value.isPublic && value.signEnabled) {
    ctx.addIssue({ code: 'custom', path: ['signEnabled'], message: '公开客户端没有密钥，无法启用 HMAC 签名' });
  }
}

export const createOAuth2ClientSchema = oauth2ClientCreateSchema.superRefine(validateOAuth2Client);

export const updateOAuth2ClientSchema = partialForUpdate(oauth2ClientBaseSchema).extend({
  status: entityStatusSchema.optional(),
});

const developerOAuth2ClientCreateSchema = oauth2ClientCreateSchema.omit({ ratePlanId: true });

export const updateDeveloperOAuth2ClientSchema = partialForUpdate(oauth2ClientBaseSchema.omit({ ratePlanId: true }));

export const createDeveloperOAuth2ClientSchema = developerOAuth2ClientCreateSchema.superRefine(validateOAuth2Client);

export type CreateOAuth2ClientInput = z.infer<typeof createOAuth2ClientSchema>;

export type UpdateOAuth2ClientInput = z.infer<typeof updateOAuth2ClientSchema>;

export type CreateDeveloperOAuth2ClientInput = z.infer<typeof createDeveloperOAuth2ClientSchema>;

export type UpdateDeveloperOAuth2ClientInput = z.infer<typeof updateDeveloperOAuth2ClientSchema>;

/** 管理端审核开发者应用；驳回必须填写审核意见（服务端校验） */
export const reviewOAuth2ClientSchema = z.object({
  action: z.enum(OAUTH2_REVIEW_ACTIONS),
  comment: z.string().max(500).optional(),
});

export type ReviewOAuth2ClientInput = z.infer<typeof reviewOAuth2ClientSchema>;

// ─── OAuth2 授权端点（用户同意页） ──────────────────────────────────────────────
const pkceCodeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'code_challenge 须为 43 位 base64url 字符');

/** 用户确认授权（OAuth 2.1 授权码模式，强制 PKCE S256）；字段名沿用 RFC 6749 的下划线命名 */
export const oauth2AuthorizeSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  response_type: z.literal('code'),
  scope: z.string(),
  state: z.string().optional(),
  code_challenge: pkceCodeChallengeSchema,
  code_challenge_method: z.enum(OAUTH2_CODE_CHALLENGE_METHODS),
});

export type OAuth2AuthorizeInput = z.infer<typeof oauth2AuthorizeSchema>;

// ─── 开发者中心：API 调试台 ───────────────────────────────────────────────────
export const openApiDebugRequestSchema = z.object({
  method: z.enum(OPEN_API_DEBUG_METHODS),
  /** 完整开放 API 路径（如 /api/open/v1/ping）；由服务端按端点目录校验 */
  path: z.string().min(1),
  query: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

export type OpenApiDebugRequestInput = z.infer<typeof openApiDebugRequestSchema>;

// ─── 开放网关核心端点 ─────────────────────────────────────────────────────────
/** 规则中心统一求值；kind 缺省为决策表，kind=list 时传 subjects（待检测主体值集合） */
export const openRuleEvaluateSchema = z.object({
  kind: z.enum(RULE_REF_KINDS).default('table'),
  key: z.string().trim().min(1, '缺少规则资产 key'),
  facts: z.record(z.string(), z.unknown()).optional(),
  subjects: z.array(z.coerce.string()).optional(),
});

export type OpenRuleEvaluateInput = z.infer<typeof openRuleEvaluateSchema>;

/** 开放应用生成短链：目标地址 + 可选自定义短码 / 标题 / 有效期，规则复用短链域 */
export const openShortLinkCreateSchema = createShortLinkSchema.pick({
  targetUrl: true,
  code: true,
  title: true,
  expiresAt: true,
});

export type OpenShortLinkCreateInput = z.infer<typeof openShortLinkCreateSchema>;

// ─── 开放平台：API Scope ──────────────────────────────────────────────────────
export const createApiScopeSchema = z.object({
  code: z
    .string()
    .min(1, 'scope 编码不能为空')
    .max(64)
    .regex(/^[a-z][a-z0-9_.:-]*$/, 'scope 编码须以小写字母开头，仅含小写字母/数字/:._-'),
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(500).optional(),
  scopeGroup: z.string().min(1).max(64).default('general'),
  status: entityStatusSchema.default('enabled'),
});

export const updateApiScopeSchema = partialForUpdate(createApiScopeSchema).omit({ code: true });

export type CreateApiScopeInput = z.input<typeof createApiScopeSchema>;

export type UpdateApiScopeInput = z.input<typeof updateApiScopeSchema>;

// ─── 开放平台：限流套餐 ───────────────────────────────────────────────────────
export const createRatePlanSchema = z.object({
  code: z
    .string()
    .min(1, '套餐编码不能为空')
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/, '套餐编码须以小写字母开头，仅含小写字母/数字/_-'),
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(500).optional(),
  qpsLimit: z.number().int().min(0).max(1_000_000).default(10),
  dailyQuota: z.number().int().min(0).default(0),
  monthlyQuota: z.number().int().min(0).default(0),
  isDefault: z.boolean().default(false),
  status: entityStatusSchema.default('enabled'),
});

export const updateRatePlanSchema = partialForUpdate(createRatePlanSchema).omit({ code: true });

export type CreateRatePlanInput = z.input<typeof createRatePlanSchema>;

export type UpdateRatePlanInput = z.input<typeof updateRatePlanSchema>;

// ─── 开放平台：签名验签工具 ───────────────────────────────────────────────────
export const openSignatureVerifySchema = z.object({
  appKey: z.string().min(1, 'AppKey 不能为空'),
  method: z.string().min(1).default('GET'),
  path: z.string().min(1, '请求路径不能为空'),
  query: z.string().optional(),
  body: z.string().optional(),
  timestamp: z.string().min(1, '时间戳不能为空'),
  nonce: z.string().min(1, '随机串不能为空'),
  /** 待校验的签名（可选；提供时返回 matched） */
  signature: z.string().optional(),
});

export type OpenSignatureVerifyInput = z.input<typeof openSignatureVerifySchema>;

// ─── 开放平台：Webhook 订阅 ───────────────────────────────────────────────────
const webhookHeadersSchema = z.record(z.string(), z.string()).superRefine((headers, ctx) => {
  for (const key of Object.keys(headers)) {
    const normalized = key.trim().toLowerCase();
    if (normalized === 'content-type' || normalized.startsWith('x-zenith-')) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: '自定义请求头不能覆盖 Content-Type 或 X-Zenith-* 保留头',
      });
    }
  }
});

const sensitiveWebhookEvents = new Set<string>([
  'payment.succeeded',
  'payment.closed',
  'payment.failed',
  'refund.succeeded',
  'refund.failed',
]);

function requireSensitiveWebhookSignature(
  value: { events?: readonly string[]; signMode?: 'hmacSha256' | 'none' },
  ctx: z.RefinementCtx,
): void {
  if (value.events?.some((event) => sensitiveWebhookEvents.has(event)) && value.signMode === 'none') {
    ctx.addIssue({ code: 'custom', path: ['signMode'], message: '支付与退款事件必须使用 HMAC-SHA256 签名' });
  }
}

export const createAppWebhookSchema = z.object({
  clientId: z.string().min(1, '请选择所属应用'),
  name: z.string().min(1, '名称不能为空').max(100),
  url: z.string().regex(/^https?:\/\/.+/, 'URL 必须以 http(s):// 开头').max(512),
  events: z.array(z.enum(OPEN_WEBHOOK_EVENTS)).default([]),
  signMode: z.enum(['hmacSha256', 'none']).default('hmacSha256'),
  headers: webhookHeadersSchema.optional(),
  status: entityStatusSchema.default('enabled'),
}).superRefine(requireSensitiveWebhookSignature);

const updateAppWebhookFieldsSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100).optional(),
  url: z.string().regex(/^https?:\/\/.+/, 'URL 必须以 http(s):// 开头').max(512).optional(),
  events: z.array(z.enum(OPEN_WEBHOOK_EVENTS)).optional(),
  signMode: z.enum(['hmacSha256', 'none']).optional(),
  headers: webhookHeadersSchema.optional(),
  status: entityStatusSchema.optional(),
}).superRefine(requireSensitiveWebhookSignature);

export const updateAppWebhookSchema = updateAppWebhookFieldsSchema;

export type CreateAppWebhookInput = z.input<typeof createAppWebhookSchema>;

export type UpdateAppWebhookInput = z.input<typeof updateAppWebhookSchema>;
