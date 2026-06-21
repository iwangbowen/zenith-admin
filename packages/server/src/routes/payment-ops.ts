import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { PaginationQuery, validationHook, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../lib/openapi-schemas';
import { PaymentOutboxEventDTO, PaymentOrderDTO } from '../lib/openapi-dtos';
import { listPaymentEvents, redispatchEvent, simulateOrderPaid } from '../services/payment-ops.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listEventsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/events', tags: ['支付中心-运营'], summary: '支付事件(Outbox)列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:ops:manage' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['pending', 'done', 'failed']).optional(), type: z.string().optional() }) },
    responses: { ...okPaginated(PaymentOutboxEventDTO, '事件列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listPaymentEvents(c.req.valid('query'))), 200),
});

const redispatchRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/events/{id}/redispatch', tags: ['支付中心-运营'], summary: '手动重投支付事件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:ops:manage', audit: { description: '手动重投支付事件', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentOutboxEventDTO, '已重投'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await redispatchEvent(c.req.valid('param').id), '已重投'), 200),
});

const simulateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/orders/{id}/simulate-paid', tags: ['支付中心-运营'], summary: '模拟支付成功（演示/联调）',
    description: '将待支付订单标记为已支付以触发履约链路。仅沙箱渠道或非生产环境可用。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:ops:manage', audit: { description: '模拟支付成功', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentOrderDTO, '已模拟支付'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await simulateOrderPaid(c.req.valid('param').id), '已模拟支付成功'), 200),
});

router.openapiRoutes([listEventsRoute, redispatchRoute, simulateRoute] as const);

export default router;
