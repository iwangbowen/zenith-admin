import { OpenAPIHono } from '@hono/zod-openapi';
import { mpStatsContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMpStats, getMpDatacube } from '../../services/mp/mp-stats.service';

const mpStatsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:statistics:view' })] as const;

const statsRoute = defineContractRoute(mpStatsContract.overview, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMpStats(c.req.valid('query').accountId)), 200),
});

const datacubeRoute = defineContractRoute(mpStatsContract.datacube, {
  middleware: read,
  handler: async (c) => {
    const { accountId, beginDate, endDate } = c.req.valid('query');
    return c.json(okBody(await getMpDatacube(accountId, beginDate, endDate)), 200);
  },
});

mpStatsRouter.openapiRoutes([statsRoute, datacubeRoute] as const);

export default mpStatsRouter;
