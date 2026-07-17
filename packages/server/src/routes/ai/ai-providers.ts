import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  IdParam,
  okBody,
} from '../../lib/openapi-schemas';
import { AiProviderConfigDTO } from '../../lib/openapi-dtos';
import {
  listAiProviderConfigs,
  getAiProviderConfig,
  createAiProviderConfig,
  updateAiProviderConfig,
  deleteAiProviderConfig,
  setDefaultAiProviderConfig,
  testAiProviderConnection,
  fetchProviderModels,
} from '../../services/ai/ai-providers.service';
import { createAiProviderConfigSchema, updateAiProviderConfigSchema, testAiConnectionSchema, fetchAiModelsSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取 AI 服务商配置列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:provider:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiProviderConfigDTO), '配置列表') },
  }),
  handler: async (c) => c.json(okBody(await listAiProviderConfigs()), 200),
});

const getOne = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['AI'],
    summary: '获取 AI 服务商配置详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:provider:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiProviderConfigDTO, '配置详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAiProviderConfig(id)), 200);
  },
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['AI'],
    summary: '创建 AI 服务商配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:provider:create' })] as const,
    request: { body: { content: jsonContent(createAiProviderConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiProviderConfigDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createAiProviderConfig(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['AI'],
    summary: '更新 AI 服务商配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:provider:edit' })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateAiProviderConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiProviderConfigDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateAiProviderConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['AI'],
    summary: '删除 AI 服务商配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:provider:delete' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteAiProviderConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const setDefault = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/set-default',
    tags: ['AI'],
    summary: '设为默认 AI 服务商',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:provider:edit' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiProviderConfigDTO, '已设为默认') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await setDefaultAiProviderConfig(id), '已设为默认'), 200);
  },
});

const TestConnectionResultDTO = z.object({ success: z.boolean(), message: z.string() }).openapi('TestAiConnectionResult');

const testConnection = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/test-connection',
    tags: ['AI'],
    summary: '测试 AI 服务商连接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:provider:edit' })] as const,
    request: { body: { content: jsonContent(testAiConnectionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(TestConnectionResultDTO, '测试结果') },
  }),
  handler: async (c) => {
    const result = await testAiProviderConnection(c.req.valid('json'));
    return c.json(okBody(result), 200);
  },
});

const fetchModels = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/fetch-models',
    tags: ['AI'],
    summary: '从供应商 API 自动发现可用模型列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:provider:edit' })] as const,
    request: { body: { content: jsonContent(fetchAiModelsSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.array(z.string()), '模型 ID 列表') },
  }),
  handler: async (c) => {
    return c.json(okBody(await fetchProviderModels(c.req.valid('json'))), 200);
  },
});

router.openapiRoutes([list, getOne, create, update, remove, setDefault, testConnection, fetchModels] as const);

export default router;
