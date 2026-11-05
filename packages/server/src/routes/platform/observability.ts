import { OpenAPIHono } from '@hono/zod-openapi';
import { observabilityContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getObservabilitySummary } from '../../services/platform/observability.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const summaryRoute = defineContractRoute(observabilityContract.summary, {
  handler: async (c) => c.json(okBody(await getObservabilitySummary(), 'success'), 200),
});

router.openapiRoutes([summaryRoute] as const);

export default router;
