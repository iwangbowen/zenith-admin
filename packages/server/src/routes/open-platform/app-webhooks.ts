import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okPaginated,
  IdParam,
  PaginationQuery,
  BatchIdsBody,
  okBody,
} from '../../lib/openapi-schemas';
import {
  AppWebhookSubscriptionDTO,
  AppWebhookSubscriptionCreatedDTO,
  AppWebhookDeliveryDTO,
  OpenWebhookEventMetaDTO,
  AppWebhookBatchRetryResultDTO,
} from '../../lib/openapi-dtos';
import { createAppWebhookSchema, updateAppWebhookSchema } from '@zenith/shared';
import {
  listSubscriptions,
  getSubscription,
  getSubscriptionBeforeAudit,
  createSubscription,
  updateSubscription,
  regenerateSubscriptionSecret,
  deleteSubscription,
  listDeliveries,
  getDelivery,
  retryDelivery,
  testSubscription,
  listWebhookEvents,
  scheduleBatchRetryDeliveries,
} from '../../services/open-platform/app-webhooks.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ListQuery = PaginationQuery.extend({
  clientId: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  keyword: z.string().optional(),
});

const deliveryBatchRetry = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deliveries/batch-retry', tags: ['AppWebhooks'], summary: '批量重试失败投递',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:manage', audit: { description: '批量重试 Webhook 投递', module: '开放平台-Webhook' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(AppWebhookBatchRetryResultDTO, '已加入重试队列') },
  }),
  handler: async (c) => c.json(okBody(await scheduleBatchRetryDeliveries(c.req.valid('json').ids), '已加入重试队列'), 200),
});

const DeliveryListQuery = PaginationQuery.extend({
  subscriptionId: z.coerce.number().int().optional(),
  clientId: z.string().optional(),
  status: z.enum(['pending', 'success', 'failed', 'retrying']).optional(),
  eventType: z.string().optional(),
});

const SecretResultDTO = z.object({ id: z.number().int(), secret: z.string() }).openapi('AppWebhookSecretResult');
const DeliveryActionDTO = z.object({ deliveryId: z.number().int() }).openapi('AppWebhookDeliveryAction');

// ─── 订阅列表 ─────────────────────────────────────────────────────────────────
const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['AppWebhooks'], summary: '获取 Webhook 订阅列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:view' })] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(AppWebhookSubscriptionDTO, 'Webhook 订阅列表') },
  }),
  handler: async (c) => c.json(okBody(await listSubscriptions(c.req.valid('query'))), 200),
});

// ─── 可订阅事件类型 ───────────────────────────────────────────────────────────
const events = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/events', tags: ['AppWebhooks'], summary: '获取可订阅的事件类型',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(OpenWebhookEventMetaDTO), '事件类型列表') },
  }),
  handler: (c) => c.json(okBody(listWebhookEvents()), 200),
});

// ─── 投递日志列表 ─────────────────────────────────────────────────────────────
const deliveryList = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/deliveries', tags: ['AppWebhooks'], summary: '获取投递日志列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:view' })] as const,
    request: { query: DeliveryListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(AppWebhookDeliveryDTO, '投递日志列表') },
  }),
  handler: async (c) => c.json(okBody(await listDeliveries(c.req.valid('query'))), 200),
});

const deliveryDetail = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/deliveries/{id}', tags: ['AppWebhooks'], summary: '获取投递详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AppWebhookDeliveryDTO, '投递详情') },
  }),
  handler: async (c) => c.json(okBody(await getDelivery(c.req.valid('param').id)), 200),
});

const deliveryRetry = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deliveries/{id}/retry', tags: ['AppWebhooks'], summary: '重试投递',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:manage', audit: { description: '重试 Webhook 投递', module: '开放平台-Webhook' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(DeliveryActionDTO, '已触发重试') },
  }),
  handler: async (c) => c.json(okBody(await retryDelivery(c.req.valid('param').id), '已触发重试'), 200),
});

// ─── 订阅详情 / 创建 / 更新 / 删除 ────────────────────────────────────────────
const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['AppWebhooks'], summary: '创建 Webhook 订阅（secret 仅返回一次）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:manage', audit: { description: '创建 Webhook 订阅', module: '开放平台-Webhook', recordResponseBody: false } })] as const,
    request: { body: { content: jsonContent(createAppWebhookSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AppWebhookSubscriptionCreatedDTO, '创建成功') },
  }),
  handler: async (c) => {
    const created = await createSubscription(c.req.valid('json'));
    setAuditAfterData(c, { ...created, secret: '[REDACTED]' });
    return c.json(okBody(created, '订阅已创建，secret 仅返回一次，请妥善保存'), 200);
  },
});

const detail = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['AppWebhooks'], summary: '获取 Webhook 订阅详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AppWebhookSubscriptionDTO, '订阅详情') },
  }),
  handler: async (c) => c.json(okBody(await getSubscription(c.req.valid('param').id)), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['AppWebhooks'], summary: '更新 Webhook 订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:manage', audit: { description: '更新 Webhook 订阅', module: '开放平台-Webhook' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateAppWebhookSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AppWebhookSubscriptionDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSubscriptionBeforeAudit(id));
    return c.json(okBody(await updateSubscription(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const regenerate = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/regenerate-secret', tags: ['AppWebhooks'], summary: '重置签名密钥（仅返回一次）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:manage', audit: { description: '重置 Webhook 密钥', module: '开放平台-Webhook', recordResponseBody: false } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(SecretResultDTO, '重置成功') },
  }),
  handler: async (c) => {
    const result = await regenerateSubscriptionSecret(c.req.valid('param').id);
    setAuditAfterData(c, { id: result.id, secret: '[REDACTED]' });
    return c.json(okBody(result, '新 secret 仅返回一次，请妥善保存'), 200);
  },
});

const test = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/test', tags: ['AppWebhooks'], summary: '发送测试投递',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:manage', audit: { description: '发送 Webhook 测试', module: '开放平台-Webhook' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(DeliveryActionDTO, '已发送测试投递') },
  }),
  handler: async (c) => c.json(okBody(await testSubscription(c.req.valid('param').id), '已发送测试投递'), 200),
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['AppWebhooks'], summary: '删除 Webhook 订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:webhook:manage', audit: { description: '删除 Webhook 订阅', module: '开放平台-Webhook' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSubscriptionBeforeAudit(id));
    await deleteSubscription(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  list, events, deliveryList, deliveryBatchRetry, deliveryDetail, deliveryRetry,
  create, detail, update, regenerate, test, remove,
] as const);

export default router;
