import { OpenAPIHono } from '@hono/zod-openapi';
import { reportExecutionContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { getDatasetExecutionStats, getReportRuntimeGovernance, listDatasetExecutionLogs } from '../../services/report/report-dataset.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(reportExecutionContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })],
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listDatasetExecutionLogs({
      ...query,
      startAt: parseDateRangeStart(query.startAt) ?? undefined,
      endAt: parseDateRangeEnd(query.endAt) ?? undefined,
    })), 200);
  },
});

const statsRoute = defineContractRoute(reportExecutionContract.stats, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })],
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await getDatasetExecutionStats({
      ...query,
      startAt: parseDateRangeStart(query.startAt) ?? undefined,
      endAt: parseDateRangeEnd(query.endAt) ?? undefined,
    })), 200);
  },
});

const governanceRoute = defineContractRoute(reportExecutionContract.governance, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })],
  handler: async (c) => c.json(okBody(getReportRuntimeGovernance()), 200),
});

router.openapiRoutes([statsRoute, governanceRoute, listRoute] as const);

export default router;
