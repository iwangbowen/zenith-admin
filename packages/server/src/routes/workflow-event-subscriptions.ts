import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import { jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, PaginationQuery, BatchIdsBody, okBody } from '../lib/openapi-schemas';
import {
  WorkflowEventSubscriptionDTO,
  WorkflowEventSubscriptionSecretDTO,
  WorkflowEventDeliveryDTO,
} from '../lib/openapi-dtos';
import {
  listSubscriptions,
  getSubscription,
  getSubscriptionSecret,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  toggleSubscription,
  getSubscriptionBeforeAudit,
  listDeliveries,
  getDelivery,
  retryDelivery,
  retryDeliveries,
  getDeliveryBeforeAudit,
  getDeliveriesBeforeAudit,
} from '../services/workflow-event-subscriptions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const WORKFLOW_EVENT_TYPES = [
  'instance.created', 'instance.approved', 'instance.rejected', 'instance.withdrawn',
  'node.entered', 'node.left',
  'task.created', 'task.assigned', 'task.approved', 'task.rejected', 'task.skipped', 'task.transferred', 'task.addSigned', 'task.reduceSigned', 'task.urged',
] as const;

const UpsertBody = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).nullish(),
  definitionId: z.number().int().nullish(),
  events: z.array(z.enum(WORKFLOW_EVENT_TYPES)).min(1),
  url: z.string().min(1).regex(/^https?:\/\//i, '必须是 http:// 或 https:// 开头的 URL'),
  secret: z.string().max(256).nullish(),
  signMode: z.enum(['hmacSha256', 'none']).optional(),
  headers: z.record(z.string(), z.string()).nullish(),
  enabled: z.boolean().optional(),
});

const ListQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  definitionId: z.coerce.number().int().optional(),
  enabled: z.coerce.boolean().optional(),
});

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['WorkflowEventSubscriptions'], summary: '获取事件订阅列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:view' })] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowEventSubscriptionDTO, '订阅列表') },
  }),
  handler: async (c) => c.json(okBody(await listSubscriptions(c.req.valid('query'))), 200),
});

const get = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['WorkflowEventSubscriptions'], summary: '获取订阅详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowEventSubscriptionDTO, '订阅详情') },
  }),
  handler: async (c) => c.json(okBody(await getSubscription(c.req.valid('param').id)), 200),
});

const getSecret = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/secret', tags: ['WorkflowEventSubscriptions'], summary: '查看订阅 secret 明文（敏感操作）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:view', audit: { description: '查看事件订阅 secret', module: '工作流管理', recordResponseBody: false } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowEventSubscriptionSecretDTO, 'secret 明文') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditAfterData(c, { id, secretViewed: true });
    return c.json(okBody(await getSubscriptionSecret(id)), 200);
  },
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['WorkflowEventSubscriptions'], summary: '创建事件订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:create', audit: { description: '创建事件订阅', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(UpsertBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowEventSubscriptionDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createSubscription(c.req.valid('json')), '已创建'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['WorkflowEventSubscriptions'], summary: '更新事件订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:edit', audit: { description: '更新事件订阅', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(UpsertBody.partial()), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowEventSubscriptionDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSubscriptionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateSubscription(id, c.req.valid('json')), '已更新'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['WorkflowEventSubscriptions'], summary: '删除事件订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:delete', audit: { description: '删除事件订阅', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSubscriptionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteSubscription(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const toggle = defineOpenAPIRoute({
  route: createRoute({
    method: 'patch', path: '/{id}/toggle', tags: ['WorkflowEventSubscriptions'], summary: '启用/禁用订阅',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:edit', audit: { description: '切换事件订阅启用状态', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ enabled: z.boolean() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowEventSubscriptionDTO, '已切换') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSubscriptionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await toggleSubscription(id, c.req.valid('json').enabled), '已切换'), 200);
  },
});

// ─── 投递记录 ──────────────────────────────────────────────────────────────

const DeliveryListQuery = PaginationQuery.extend({
  subscriptionId: z.coerce.number().int().optional(),
  instanceId: z.coerce.number().int().optional(),
  status: z.enum(['pending', 'success', 'failed', 'retrying']).optional(),
});

const listDeliveriesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/deliveries/list', tags: ['WorkflowEventSubscriptions'], summary: '事件投递记录列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-delivery:view' })] as const,
    request: { query: DeliveryListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowEventDeliveryDTO, '投递列表') },
  }),
  handler: async (c) => c.json(okBody(await listDeliveries(c.req.valid('query'))), 200),
});

const getDeliveryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/deliveries/{id}', tags: ['WorkflowEventSubscriptions'], summary: '投递记录详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-delivery:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowEventDeliveryDTO, '详情') },
  }),
  handler: async (c) => c.json(okBody(await getDelivery(c.req.valid('param').id)), 200),
});

const retryDeliveryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deliveries/{id}/retry', tags: ['WorkflowEventSubscriptions'], summary: '重试投递',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-delivery:retry', audit: { description: '重试事件投递', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowEventDeliveryDTO, '已加入重试队列') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDeliveryBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await retryDelivery(id), '已加入重试队列'), 200);
  },
});

const batchRetryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deliveries/batch-retry', tags: ['WorkflowEventSubscriptions'], summary: '批量重试投递',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:event-delivery:retry', audit: { description: '批量重试事件投递', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.object({ count: z.number().int() }), '已加入重试队列') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getDeliveriesBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await retryDeliveries(ids);
    const after = await getDeliveriesBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
    return c.json(okBody({ count }, '已加入重试队列'), 200);
  },
});

router.openapiRoutes([
  list, get, getSecret, create, update, remove, toggle,
  listDeliveriesRoute, getDeliveryRoute, retryDeliveryRoute, batchRetryRoute,
] as const);

export default router;
