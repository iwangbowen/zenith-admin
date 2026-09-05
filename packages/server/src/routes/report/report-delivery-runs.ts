import { OpenAPIHono } from '@hono/zod-openapi';
import { reportDeliveryRunContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { acknowledgeAlertDeliveryRun, listAccessibleDeliveryRuns } from '../../services/report/report-delivery.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(reportDeliveryRunContract.list, {
  middleware: [authMiddleware, guard({ permission: ['report:alert:list', 'report:subscription:list'] })],
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listAccessibleDeliveryRuns({
      ...query,
      startAt: parseDateRangeStart(query.startAt) ?? undefined,
      endAt: parseDateRangeEnd(query.endAt) ?? undefined,
    })), 200);
  },
});

const ackRoute = defineContractRoute(reportDeliveryRunContract.acknowledge, {
  middleware: [authMiddleware, guard({ permission: 'report:alert:update' })],
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  handler: async (c) => c.json(okBody(await acknowledgeAlertDeliveryRun(c.req.valid('param').id, c.req.valid('json').note), '确认成功'), 200),
});

router.openapiRoutes([listRoute, ackRoute] as const);

export default router;
