import { OpenAPIHono } from '@hono/zod-openapi';
import { ipAccessContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getClientIp } from '../../lib/request-helpers';
import { diagnoseIpAccess, getIpAccessContext } from '../../services/platform/ip-access.service';
import { ipAccessLogStats } from '../../services/platform/ip-access-logs.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([defineContractRoute(ipAccessContract.logHealth, {
  handler: async (c) => c.json(okBody(ipAccessLogStats()), 200),
}), defineContractRoute(ipAccessContract.context, {
  handler: async (c) => c.json(okBody(await getIpAccessContext(getClientIp(c))), 200),
}), defineContractRoute(ipAccessContract.diagnose, {
  handler: async (c) => c.json(okBody(await diagnoseIpAccess(c.req.valid('json'), getClientIp(c))), 200),
})]);
export default router;
