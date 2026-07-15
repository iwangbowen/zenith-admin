/**
 * 开放平台 / 开发者门户相关 DTO
 *   - API Scope 注册表
 *   - 限流套餐（Rate Plan）
 *   - 调用统计 / 调用日志
 *   - 签名验签工具
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

// ─── API Scope ────────────────────────────────────────────────────────────────

export const ApiScopeDTO = z
  .object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    scopeGroup: z.string(),
    status: z.enum(['enabled', 'disabled']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ApiScope');

// ─── 限流套餐 ─────────────────────────────────────────────────────────────────

export const RatePlanDTO = z
  .object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    qpsLimit: z.number().int(),
    dailyQuota: z.number().int(),
    monthlyQuota: z.number().int(),
    isDefault: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('RatePlan');

// ─── 调用日志 ─────────────────────────────────────────────────────────────────

export const OpenApiCallLogDTO = z
  .object({
    id: z.number().int(),
    clientId: z.string(),
    appName: z.string().nullable(),
    method: z.string(),
    path: z.string(),
    statusCode: z.number().int(),
    success: z.boolean(),
    durationMs: z.number().int(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    scope: z.string().nullable(),
    errorMessage: z.string().nullable(),
    requestId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('OpenApiCallLog');

// ─── 调用统计 ─────────────────────────────────────────────────────────────────

export const OpenApiStatsOverviewDTO = z
  .object({
    totalCalls: z.number().int(),
    successCalls: z.number().int(),
    failedCalls: z.number().int(),
    successRate: z.number(),
    avgDurationMs: z.number(),
    p95DurationMs: z.number(),
    p99DurationMs: z.number(),
    activeApps: z.number().int(),
    todayCalls: z.number().int(),
  })
  .openapi('OpenApiStatsOverview');

export const OpenApiStatsTrendPointDTO = z
  .object({
    time: z.string(),
    total: z.number().int(),
    success: z.number().int(),
    failed: z.number().int(),
  })
  .openapi('OpenApiStatsTrendPoint');

export const OpenApiStatsGroupItemDTO = z
  .object({
    key: z.string(),
    label: z.string(),
    total: z.number().int(),
    success: z.number().int(),
    failed: z.number().int(),
    avgDurationMs: z.number(),
  })
  .openapi('OpenApiStatsGroupItem');

// ─── 签名验签工具 ─────────────────────────────────────────────────────────────

export const OpenSignatureResultDTO = z
  .object({
    signature: z.string(),
    stringToSign: z.string(),
    matched: z.boolean().optional(),
  })
  .openapi('OpenSignatureResult');

export const OpenSignatureAlgorithmDTO = z
  .object({
    algorithm: z.string(),
    timestampWindow: z.number().int(),
    headers: z.object({
      appKey: z.string(),
      timestamp: z.string(),
      nonce: z.string(),
      signature: z.string(),
    }),
    /** 待签名字符串拼装说明 */
    stringToSignFormat: z.string(),
    steps: z.array(z.string()),
  })
  .openapi('OpenSignatureAlgorithm');

// ─── Webhook 订阅 ─────────────────────────────────────────────────────────────

export const AppWebhookSubscriptionDTO = z
  .object({
    id: z.number().int(),
    clientId: z.string(),
    name: z.string(),
    url: z.string(),
    signMode: z.enum(['hmacSha256', 'none']),
    events: z.array(z.string()),
    headers: z.record(z.string(), z.string()).nullable(),
    status: z.enum(['enabled', 'disabled']),
    hasSecret: z.boolean(),
    secretMasked: z.string().nullable(),
    lastDeliveryAt: z.string().nullable(),
    consecutiveFailures: z.number().int(),
    autoDisabledAt: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AppWebhookSubscription');

/** 创建/重置时一次性返回明文 secret */
export const AppWebhookSubscriptionCreatedDTO = AppWebhookSubscriptionDTO.extend({
  secret: z.string(),
}).openapi('AppWebhookSubscriptionCreated');

export const AppWebhookDeliveryDTO = z
  .object({
    id: z.number().int(),
    subscriptionId: z.number().int(),
    clientId: z.string(),
    eventType: z.string(),
    eventId: z.string(),
    status: z.enum(['pending', 'success', 'failed', 'retrying']),
    attempt: z.number().int(),
    requestUrl: z.string().nullable(),
    responseStatus: z.number().int().nullable(),
    responseBody: z.string().nullable(),
    errorMessage: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    nextRetryAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('AppWebhookDelivery');

export const AppWebhookBatchRetryResultDTO = z
  .object({ scheduled: z.number().int() })
  .openapi('AppWebhookBatchRetryResult');

export const OpenWebhookEventMetaDTO = z
  .object({
    code: z.string(),
    label: z.string(),
  })
  .openapi('OpenWebhookEventMeta');
