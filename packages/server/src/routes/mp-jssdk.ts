import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okBody,
} from '../lib/openapi-schemas';
import { getMpJsConfigSchema } from '@zenith/shared';
import { MpJsConfigDTO } from '../lib/openapi-dtos';
import { getMpJsConfig } from '../services/mp-jssdk.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const configRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/config', tags: ['公众号 JS-SDK'], summary: '生成 JS-SDK wx.config 签名',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:jssdk:config' })] as const,
    request: { body: { content: jsonContent(getMpJsConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpJsConfigDTO, 'JS-SDK 配置') },
  }),
  handler: async (c) => { const b = c.req.valid('json'); return c.json(okBody(await getMpJsConfig(b.accountId, b.url)), 200); },
});

router.openapiRoutes([configRoute] as const);

export default router;
