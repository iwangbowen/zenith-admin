import { OpenAPIHono } from '@hono/zod-openapi';
import { mpJsSdkContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMpJsConfig } from '../../services/mp/mp-jssdk.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const configRoute = defineContractRoute(mpJsSdkContract.config, {
  middleware: [authMiddleware, guard({ permission: 'mp:jssdk:config' })],
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await getMpJsConfig(b.accountId, b.url)), 200);
  },
});

router.openapiRoutes([configRoute] as const);

export default router;
