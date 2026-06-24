import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { jsonContent, validationHook, commonErrorResponses, ok, okBody } from '../lib/openapi-schemas';
import { buildMpOAuthUrlSchema } from '@zenith/shared';
import { MpOAuthUrlDTO } from '../lib/openapi-dtos';
import { buildMpOAuthUrl } from '../services/mp-oauth.service';

const mpOAuthRouter = new OpenAPIHono({ defaultHook: validationHook });

const buildUrlRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/url', tags: ['公众号网页授权'], summary: '生成网页授权链接',
    description: '生成 OAuth2 网页授权跳转链接（snsapi_base / snsapi_userinfo），用于 H5 集成或测试。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:oauth:build' })] as const,
    request: { body: { content: jsonContent(buildMpOAuthUrlSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpOAuthUrlDTO, '生成成功') },
  }),
  handler: async (c) => c.json(okBody(await buildMpOAuthUrl(c.req.valid('json')), '生成成功'), 200),
});

mpOAuthRouter.openapiRoutes([buildUrlRoute] as const);

export default mpOAuthRouter;
