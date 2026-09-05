import { OpenAPIHono } from '@hono/zod-openapi';
import { aiChatModelContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listChatModels } from '../../services/ai/ai-providers.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineContractRoute(aiChatModelContract.list, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listChatModels()), 200),
});

router.openapiRoutes([list] as const);

export default router;
