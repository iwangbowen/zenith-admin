import { OpenAPIHono } from '@hono/zod-openapi';
import { mpSecurityContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { checkMpContent } from '../../services/mp/mp-security.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const checkTextRoute = defineContractRoute(mpSecurityContract.checkText, {
  middleware: [authMiddleware, guard({ permission: 'mp:security:check' })],
  handler: async (c) => c.json(okBody(await checkMpContent(c.req.valid('json'))), 200),
});

router.openapiRoutes([checkTextRoute] as const);

export default router;
