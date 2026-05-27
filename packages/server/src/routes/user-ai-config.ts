import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okBody,
} from '../lib/openapi-schemas';
import { UserAiConfigDTO } from '../lib/openapi-dtos';
import { getUserAiConfig, saveUserAiConfig } from '../services/user-ai-config.service';
import { saveUserAiConfigSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const getConfig = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取我的 AI 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(UserAiConfigDTO.nullable(), '我的 AI 配置') },
  }),
  handler: async (c) => c.json(okBody(await getUserAiConfig()), 200),
});

const saveConfig = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/',
    tags: ['AI'],
    summary: '保存我的 AI 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(saveUserAiConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(UserAiConfigDTO, '保存成功') },
  }),
  handler: async (c) => c.json(okBody(await saveUserAiConfig(c.req.valid('json')), '保存成功'), 200),
});

router.openapiRoutes([getConfig, saveConfig] as const);

export default router;
