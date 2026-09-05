/**
 * 渠道推广分析（纯读）
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { channelAnalysisContract } from '@zenith/shared/short-link';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getChannelAnalysis } from '../../services/short-link/channel-analysis.service';

const channelAnalysisRouter = new OpenAPIHono({ defaultHook: validationHook });

const analysisRoute = defineContractRoute(channelAnalysisContract.analyze, {
  middleware: [authMiddleware, guard({ permission: 'shortlink:analysis:view' })],
  handler: async (c) => c.json(okBody(await getChannelAnalysis(c.req.valid('query'))), 200),
});

channelAnalysisRouter.openapiRoutes([analysisRoute] as const);

export default channelAnalysisRouter;
