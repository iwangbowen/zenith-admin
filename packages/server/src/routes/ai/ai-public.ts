import { OpenAPIHono } from '@hono/zod-openapi';
import { aiPublicContract } from '@zenith/shared/ai';
import { namedRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getSharedConversation } from '../../services/ai/ai-share.service';

/** 公开访问（无需登录）：对话分享只读页数据 */
const router = new OpenAPIHono({ defaultHook: validationHook });

const getShared = defineContractRoute(aiPublicContract.sharedConversation, {
  middleware: [namedRateLimit('ai_share_view')],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    return c.json(okBody(await getSharedConversation(token)), 200);
  },
});

router.openapiRoutes([getShared] as const);

export default router;
