import { OpenAPIHono } from '@hono/zod-openapi';
import { wikiStatsContract } from '@zenith/shared/wiki';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { getWikiStatsOverview, listWikiContributors, listWikiHotDocs, listWikiStaleDocs } from '../../services/wiki/stats.service';
import { getWikiOpsStats } from '../../services/wiki/governance.service';

const statsRouter = new OpenAPIHono({ defaultHook: validationHook });

const statsRead = [authMiddleware, guard({ permission: 'wiki:stats:view' })] as const;

const overviewRoute = defineContractRoute(wikiStatsContract.overview, {
  middleware: statsRead,
  handler: async (c) => c.json(okBody(await getWikiStatsOverview()), 200),
});

const hotDocsRoute = defineContractRoute(wikiStatsContract.hotDocs, {
  middleware: statsRead,
  handler: async (c) => {
    const { limit } = c.req.valid('query');
    return c.json(okBody(await listWikiHotDocs(limit)), 200);
  },
});

const contributorsRoute = defineContractRoute(wikiStatsContract.contributors, {
  middleware: statsRead,
  handler: async (c) => {
    const { limit } = c.req.valid('query');
    return c.json(okBody(await listWikiContributors(limit)), 200);
  },
});

const staleDocsRoute = defineContractRoute(wikiStatsContract.staleDocs, {
  middleware: statsRead,
  handler: async (c) => {
    const { limit } = c.req.valid('query');
    return c.json(okBody(await listWikiStaleDocs(limit)), 200);
  },
});

const opsStatsRoute = defineContractRoute(wikiStatsContract.ops, {
  middleware: statsRead,
  handler: async (c) => c.json(okBody(await getWikiOpsStats()), 200),
});

statsRouter.openapiRoutes([
  overviewRoute,
  hotDocsRoute,
  contributorsRoute,
  staleDocsRoute,
  opsStatsRoute,
] as const);

export default statsRouter;
