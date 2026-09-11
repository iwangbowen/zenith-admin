import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { OPEN_WEBHOOK_DELIVERY_STATUSES, OPEN_WEBHOOK_SIGN_MODES } from '../constants';
import { createAppWebhookSchema, updateAppWebhookSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 应用级 Webhook 订阅 */
export const appWebhookSubscriptionSchema = z.object({
  id: z.int(),
  clientId: z.string().nullable().meta({ description: '所属应用 client_id；系统内部订阅为 null' }),
  tenantId: z.int().nullable(),
  name: z.string(),
  url: z.string().meta({ example: 'https://example.com/webhook' }),
  signMode: z.enum(OPEN_WEBHOOK_SIGN_MODES),
  events: z.array(z.string()).meta({ description: '订阅事件；空数组 = 全部非支付事件' }),
  headers: z.record(z.string(), z.string()).nullable(),
  status: entityStatusSchema,
  hasSecret: z.boolean().meta({ description: '是否已配置签名密钥' }),
  secretMasked: z.string().nullable().meta({ description: '密钥掩码；未配置为 null' }),
  lastDeliveryAt: z.string().nullable(),
  consecutiveFailures: z.int(),
  autoDisabledAt: z.string().nullable().meta({ description: '连续失败触发自动停用的时间' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AppWebhookSubscription' });

export type AppWebhookSubscription = z.infer<typeof appWebhookSubscriptionSchema>;

/** 创建时一次性返回明文 secret（signMode=none 时为空串） */
export const appWebhookSubscriptionCreatedSchema = appWebhookSubscriptionSchema.extend({
  secret: z.string(),
}).meta({ id: 'AppWebhookSubscriptionCreated' });

export type AppWebhookSubscriptionCreated = z.infer<typeof appWebhookSubscriptionCreatedSchema>;

/** 重置签名密钥时一次性返回明文 secret */
export const appWebhookSecretResultSchema = z.object({
  id: z.int(),
  secret: z.string(),
}).meta({ id: 'AppWebhookSecretResult' });

export type AppWebhookSecretResult = z.infer<typeof appWebhookSecretResultSchema>;

/** Webhook 投递记录 */
export const appWebhookDeliverySchema = z.object({
  id: z.int(),
  subscriptionId: z.int(),
  clientId: z.string().nullable(),
  tenantId: z.int().nullable(),
  eventType: z.string().meta({ example: 'app.test' }),
  eventId: z.string(),
  status: z.enum(OPEN_WEBHOOK_DELIVERY_STATUSES),
  attempt: z.int(),
  requestUrl: z.string().nullable(),
  responseStatus: z.int().nullable(),
  responseBody: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.int().nullable(),
  nextRetryAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'AppWebhookDelivery' });

export type AppWebhookDelivery = z.infer<typeof appWebhookDeliverySchema>;

/** 测试投递 / 手动重试触发的投递记录 */
export const appWebhookDeliveryActionSchema = z.object({
  deliveryId: z.int(),
}).meta({ id: 'AppWebhookDeliveryAction' });

export type AppWebhookDeliveryAction = z.infer<typeof appWebhookDeliveryActionSchema>;

export const appWebhookBatchRetryResultSchema = z.object({
  scheduled: z.int().meta({ description: '实际加入重试队列的投递数' }),
}).meta({ id: 'AppWebhookBatchRetryResult' });

export type AppWebhookBatchRetryResult = z.infer<typeof appWebhookBatchRetryResultSchema>;

/** 事件类型元数据（供订阅界面选择） */
export const openWebhookEventMetaSchema = z.object({
  code: z.string(),
  label: z.string(),
}).meta({ id: 'OpenWebhookEventMeta' });

export type OpenWebhookEventMeta = z.infer<typeof openWebhookEventMetaSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const appWebhookListQuery = paginationQuery.extend({
  clientId: z.string().optional(),
  status: entityStatusQuery,
  keyword: z.string().optional().meta({ description: '按名称 / 回调地址模糊匹配' }),
});

export const appWebhookDeliveryListQuery = paginationQuery.extend({
  subscriptionId: z.coerce.number().int().optional(),
  clientId: z.string().optional(),
  status: queryEnum(OPEN_WEBHOOK_DELIVERY_STATUSES),
  eventType: z.string().optional(),
});

/**
 * Webhook 订阅管理契约组。同一订阅模型在开放平台（全部事件）与支付中心（仅支付 / 退款事件）
 * 各挂一份，路径根与文档标签不同、操作完全一致，由此函数生成。
 */
export function defineAppWebhookContract(basePath: string, tags: readonly string[]) {
  return defineContract(basePath, {
    list: op.get('/', { query: appWebhookListQuery, response: paginated(appWebhookSubscriptionSchema), summary: '获取 Webhook 订阅列表' }),
    events: op.get('/events', { response: z.array(openWebhookEventMetaSchema), summary: '获取可订阅的事件类型' }),
    deliveries: op.get('/deliveries', { query: appWebhookDeliveryListQuery, response: paginated(appWebhookDeliverySchema), summary: '获取投递日志列表' }),
    batchRetryDeliveries: op.post('/deliveries/batch-retry', { body: batchIdsBody, response: appWebhookBatchRetryResultSchema, summary: '批量重试失败投递' }),
    deliveryDetail: op.get('/deliveries/{id}', { params: idParam, response: appWebhookDeliverySchema, summary: '获取投递详情' }),
    retryDelivery: op.post('/deliveries/{id}/retry', { params: idParam, response: appWebhookDeliveryActionSchema, summary: '重试投递' }),
    create: op.post('/', { body: createAppWebhookSchema, response: appWebhookSubscriptionCreatedSchema, summary: '创建 Webhook 订阅（secret 仅返回一次）' }),
    detail: op.get('/{id}', { params: idParam, response: appWebhookSubscriptionSchema, summary: '获取 Webhook 订阅详情' }),
    update: op.put('/{id}', { params: idParam, body: updateAppWebhookSchema, response: appWebhookSubscriptionSchema, summary: '更新 Webhook 订阅' }),
    regenerateSecret: op.post('/{id}/regenerate-secret', { params: idParam, response: appWebhookSecretResultSchema, summary: '重置签名密钥（仅返回一次）' }),
    test: op.post('/{id}/test', { params: idParam, response: appWebhookDeliveryActionSchema, summary: '发送测试投递' }),
    remove: op.delete('/{id}', { params: idParam, summary: '删除 Webhook 订阅' }),
  }, { tags });
}

export type AppWebhookContract = ReturnType<typeof defineAppWebhookContract>;

/** 开放平台 Webhook：全部可订阅事件 */
export const appWebhookContract = defineAppWebhookContract('/api/app-webhooks', ['AppWebhooks']);

/** 支付中心 Webhook：同一订阅模型限定在支付 / 退款事件域 */
export const paymentWebhookContract = defineAppWebhookContract('/api/payment/webhooks', ['支付中心-Webhook']);
