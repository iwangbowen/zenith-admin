import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { PaginationQuery, validationHook, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentOutboxEventDTO, PaymentOrderDTO, PaymentOpsHealthDTO } from '../../lib/openapi-dtos';
import { getPaymentEvent, getPaymentHealth, listPaymentEvents, redispatchEvent, simulateOrderPaid } from '../../services/payment/payment-ops.service';
import { getOrderDetail } from '../../services/payment/payment.service';

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
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getPaymentEvent(id));
    return c.json(okBody(await redispatchEvent(id), '已重投'), 200);
  },
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
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOrderDetail(id));
    return c.json(okBody(await simulateOrderPaid(id), '已模拟支付成功'), 200);
  },
});

const healthRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/health', tags: ['支付中心-运营'], summary: '支付链路健康指标',
    description: 'Outbox 积压/死信、Webhook 待投递/24h 失败、处理中分账/转账、待处理对账差异，用于运维监控与告警。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:ops:manage' })] as const,
    responses: { ...ok(PaymentOpsHealthDTO, '健康指标'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getPaymentHealth()), 200),
});

router.openapiRoutes([listEventsRoute, healthRoute, redispatchRoute, simulateRoute] as const);

export default router;
