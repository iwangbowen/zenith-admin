import { OpenAPIHono } from '@hono/zod-openapi';
import { jobMonitorContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getJobMonitorOverview, listJobMonitorStuck, getJobMonitorTrend } from '../../services/platform/job-monitor.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([defineContractRoute(jobMonitorContract.overview, {
  handler: async c => c.json(okBody(await getJobMonitorOverview()), 200),
}), defineContractRoute(jobMonitorContract.stuck, {
  handler: async c => c.json(okBody(await listJobMonitorStuck(c.req.valid('param').key, c.req.valid('query').limit)), 200),
}), defineContractRoute(jobMonitorContract.trend, {
  handler: async c => c.json(okBody(await getJobMonitorTrend(c.req.valid('query').range)), 200),
})]);
export default router;
