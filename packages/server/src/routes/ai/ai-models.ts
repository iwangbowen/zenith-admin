import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { validationHook, commonErrorResponses, ok, okBody } from '../../lib/openapi-schemas';
import { AiChatModelDTO } from '../../lib/openapi-dtos';
import { listChatModels } from '../../services/ai/ai-providers.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '聊天可用模型列表（所有登录用户，仅返回启用配置的非敏感字段）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiChatModelDTO), '可用模型列表') },
  }),
  handler: async (c) => {
    return c.json(okBody(await listChatModels()), 200);
  },
});

router.openapiRoutes([list] as const);

export default router;
