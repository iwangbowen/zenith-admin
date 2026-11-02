import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentOpsContract } from '@zenith/shared/payment';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getClientIp } from '../../lib/request-helpers';
import { getPaymentEvent, getPaymentHealth, listPaymentEventAttempts, listPaymentEvents, redispatchEvent, simulateOrderPaid } from '../../services/payment/payment-ops.service';
import { getOrderDetail } from '../../services/payment/payment.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listEventsRoute = defineContractRoute(paymentOpsContract.events, {
  handler: async (c) => c.json(okBody(await listPaymentEvents(c.req.valid('query'))), 200),
});

const eventAttemptsRoute = defineContractRoute(paymentOpsContract.eventAttempts, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listPaymentEventAttempts(id)), 200);
  },
});

const redispatchRoute = defineContractRoute(paymentOpsContract.redispatchEvent, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getPaymentEvent(id));
    const event = await redispatchEvent(id);
    return c.json(okBody(event, '已提交消费者重试'), 200);
  },
});

const simulateRoute = defineContractRoute(paymentOpsContract.simulateOrderPaid, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOrderDetail(id));
    return c.json(okBody(await simulateOrderPaid(id, getClientIp(c)), '已模拟支付成功'), 200);
  },
});

const healthRoute = defineContractRoute(paymentOpsContract.health, {
  handler: async (c) => c.json(okBody(await getPaymentHealth()), 200),
});

router.openapiRoutes([listEventsRoute, eventAttemptsRoute, healthRoute, redispatchRoute, simulateRoute] as const);

export default router;
