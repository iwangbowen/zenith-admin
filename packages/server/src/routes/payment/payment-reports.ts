import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentReportContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getReportSummary } from '../../services/payment/payment-report.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const summaryRoute = defineContractRoute(paymentReportContract.summary, {
  middleware: [authMiddleware, guard({ permission: 'payment:report:view' })],
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await getReportSummary({ ...q, compare: q.compare === true })), 200);
  },
});

router.openapiRoutes([summaryRoute] as const);

export default router;
