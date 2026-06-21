import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery,
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okPaginated,
  okMsg,
  IdParam,
  okBody,
} from '../lib/openapi-schemas';
import { PaymentWebhookEndpointDTO, PaymentWebhookDeliveryDTO } from '../lib/openapi-dtos';
import {
  listEndpoints,
  getEndpoint,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  listDeliveries,
  redeliver,
} from '../services/payment-webhook.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const PAYMENT_EVENTS = ['payment.succeeded', 'payment.closed', 'payment.failed', 'refund.succeeded', 'refund.failed'] as const;
const endpointCreateSchema = z.object({
  name: z.string().min(1).max(64),
  url: z.string().url().max(512),
  bizType: z.string().max(64).optional(),
  events: z.array(z.enum(PAYMENT_EVENTS)).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  secret: z.string().max(256).optional(),
  remark: z.string().max(256).optional(),
});
const endpointUpdateSchema = endpointCreateSchema.partial();

const listEndpointsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/endpoints', tags: ['支付中心-Webhook'], summary: 'Webhook 端点列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:webhook:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['enabled', 'disabled']).optional() }) },
    responses: { ...okPaginated(PaymentWebhookEndpointDTO, 'Webhook 端点列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listEndpoints(c.req.valid('query'))), 200),
});

const getEndpointRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/endpoints/{id}', tags: ['支付中心-Webhook'], summary: 'Webhook 端点详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:webhook:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentWebhookEndpointDTO, '端点详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getEndpoint(c.req.valid('param').id)), 200),
});

const createEndpointRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/endpoints', tags: ['支付中心-Webhook'], summary: '创建 Webhook 端点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:webhook:create', audit: { description: '创建支付 Webhook 端点', module: '支付中心', recordBody: false } })] as const,
    request: { body: { content: jsonContent(endpointCreateSchema), required: true } },
    responses: { ...ok(PaymentWebhookEndpointDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createEndpoint(c.req.valid('json')), '创建成功'), 200),
});

const updateEndpointRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/endpoints/{id}', tags: ['支付中心-Webhook'], summary: '更新 Webhook 端点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:webhook:update', audit: { description: '更新支付 Webhook 端点', module: '支付中心', recordBody: false } })] as const,
    request: { params: IdParam, body: { content: jsonContent(endpointUpdateSchema), required: true } },
    responses: { ...ok(PaymentWebhookEndpointDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getEndpoint(id));
    return c.json(okBody(await updateEndpoint(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteEndpointRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/endpoints/{id}', tags: ['支付中心-Webhook'], summary: '删除 Webhook 端点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:webhook:delete', audit: { description: '删除支付 Webhook 端点', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getEndpoint(id));
    await deleteEndpoint(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listDeliveriesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/deliveries', tags: ['支付中心-Webhook'], summary: 'Webhook 投递日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:webhook:list' })] as const,
    request: { query: PaginationQuery.extend({ endpointId: z.coerce.number().int().optional(), status: z.enum(['pending', 'success', 'failed']).optional(), keyword: z.string().optional() }) },
    responses: { ...okPaginated(PaymentWebhookDeliveryDTO, '投递日志'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listDeliveries(c.req.valid('query'))), 200),
});

const redeliverRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deliveries/{id}/redeliver', tags: ['支付中心-Webhook'], summary: '手动重投 Webhook',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:webhook:update', audit: { description: '手动重投支付 Webhook', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentWebhookDeliveryDTO, '已重投'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await redeliver(c.req.valid('param').id), '已重投'), 200),
});

router.openapiRoutes([
  listEndpointsRoute,
  createEndpointRoute,
  listDeliveriesRoute,
  redeliverRoute,
  getEndpointRoute,
  updateEndpointRoute,
  deleteEndpointRoute,
] as const);

export default router;
