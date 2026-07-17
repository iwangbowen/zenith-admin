import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { namedRateLimit } from '../../middleware/rate-limit';
import { validationHook, commonErrorResponses, ok, okBody } from '../../lib/openapi-schemas';
import { AiSharedConversationDTO } from '../../lib/openapi-dtos';
import { getSharedConversation } from '../../services/ai/ai-share.service';

/** 公开访问（无需登录）：对话分享只读页数据 */
const router = new OpenAPIHono({ defaultHook: validationHook });

const getShared = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/chat/{token}',
    tags: ['AI'],
    summary: '按分享 token 读取只读对话（公开，无需登录）',
    middleware: [namedRateLimit('ai_share_view')] as const,
    request: { params: z.object({ token: z.string().min(8).max(64) }) },
    responses: { ...commonErrorResponses, ...ok(AiSharedConversationDTO, '只读对话内容') },
  }),
  handler: async (c) => {
    const { token } = c.req.valid('param');
    return c.json(okBody(await getSharedConversation(token)), 200);
  },
});

router.openapiRoutes([getShared] as const);

export default router;
