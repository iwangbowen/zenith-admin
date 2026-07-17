import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { jsonContent, validationHook, commonErrorResponses, ok, okBody } from '../../lib/openapi-schemas';
import { AiUserPreferenceDTO } from '../../lib/openapi-dtos';
import { getMyAiPreference, saveMyAiPreference } from '../../services/ai/ai-preferences.service';
import { saveAiPreferenceSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const get = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取我的 AI 个性化指令',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(AiUserPreferenceDTO, '个性化指令') },
  }),
  handler: async (c) => c.json(okBody(await getMyAiPreference()), 200),
});

const save = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/',
    tags: ['AI'],
    summary: '保存我的 AI 个性化指令',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(saveAiPreferenceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiUserPreferenceDTO, '保存成功') },
  }),
  handler: async (c) => c.json(okBody(await saveMyAiPreference(c.req.valid('json')), '保存成功'), 200),
});

router.openapiRoutes([get, save] as const);

export default router;
