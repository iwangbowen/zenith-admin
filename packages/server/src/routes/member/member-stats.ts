import { OpenAPIHono } from '@hono/zod-openapi';
import { memberStatsContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMemberStats, getMemberCharts } from '../../services/member/member-stats.service';

const memberStatsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'member:dashboard:view' })] as const;

const overviewRoute = defineContractRoute(memberStatsContract.overview, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMemberStats()), 200),
});

const chartsRoute = defineContractRoute(memberStatsContract.charts, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMemberCharts()), 200),
});

memberStatsRouter.openapiRoutes([overviewRoute, chartsRoute] as const);

export default memberStatsRouter;
