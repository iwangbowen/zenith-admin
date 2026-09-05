import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentCapabilityContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listEffectivePaymentCapabilities } from '../../services/payment/payment-capability.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const capabilityRoute = defineContractRoute(paymentCapabilityContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:list' })],
  handler: async (c) => c.json(okBody(await listEffectivePaymentCapabilities(c.req.valid('query'))), 200),
});

router.openapiRoutes([capabilityRoute] as const);

export default router;
