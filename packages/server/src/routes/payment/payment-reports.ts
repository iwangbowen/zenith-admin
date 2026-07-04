import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { validationHook, commonErrorResponses, ok, okBody } from '../../lib/openapi-schemas';
import { PaymentReportSummaryDTO } from '../../lib/openapi-dtos';
import { getReportSummary } from '../../services/payment/payment-report.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const summaryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/summary', tags: ['支付中心-财务报表'], summary: '财务报表汇总（按业务类型/渠道/日）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:report:view' })] as const,
    request: {
      query: z.object({
        groupBy: z.enum(['bizType', 'channel', 'day']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        compare: z.enum(['true', 'false']).optional().openapi({ description: '环比：附带上一等长周期汇总（需提供时间范围）' }),
      }),
    },
    responses: { ...ok(PaymentReportSummaryDTO, '财务报表汇总'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await getReportSummary({ ...q, compare: q.compare === 'true' })), 200);
  },
});

router.openapiRoutes([summaryRoute] as const);

export default router;
