import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentOpsContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getClientIp } from '../../lib/request-helpers';
import { getPaymentEvent, getPaymentHealth, listPaymentEvents, redispatchEvent, simulateOrderPaid } from '../../services/payment/payment-ops.service';
import { getOrderDetail } from '../../services/payment/payment.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listEventsRoute = defineContractRoute(paymentOpsContract.events, {
  middleware: [authMiddleware, guard({ permission: 'payment:ops:manage' })],
  handler: async (c) => c.json(okBody(await listPaymentEvents(c.req.valid('query'))), 200),
});

const redispatchRoute = defineContractRoute(paymentOpsContract.redispatchEvent, {
  middleware: [authMiddleware, guard({ permission: 'payment:ops:manage', audit: { description: '手动重投支付事件', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getPaymentEvent(id));
    return c.json(okBody(await redispatchEvent(id), '已重投'), 200);
  },
});

const simulateRoute = defineContractRoute(paymentOpsContract.simulateOrderPaid, {
  middleware: [authMiddleware, guard({ permission: 'payment:ops:manage', audit: { description: '模拟支付成功', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOrderDetail(id));
    return c.json(okBody(await simulateOrderPaid(id, getClientIp(c)), '已模拟支付成功'), 200);
  },
});

const healthRoute = defineContractRoute(paymentOpsContract.health, {
  middleware: [authMiddleware, guard({ permission: 'payment:ops:manage' })],
  handler: async (c) => c.json(okBody(await getPaymentHealth()), 200),
});

router.openapiRoutes([listEventsRoute, healthRoute, redispatchRoute, simulateRoute] as const);

export default router;
