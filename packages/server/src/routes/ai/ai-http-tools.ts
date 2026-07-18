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
import { AiHttpToolDTO, AiToolInfoDTO } from '../../lib/openapi-dtos';
import { listHttpTools, createHttpTool, updateHttpTool, deleteHttpTool } from '../../services/ai/ai-http-tools.service';
import { listAvailableTools } from '../../lib/ai/tools';
import { createAiHttpToolSchema, updateAiHttpToolSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取 HTTP API 工具列表（管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:tool:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiHttpToolDTO), '工具列表') },
  }),
  handler: async (c) => c.json(okBody(await listHttpTools()), 200),
});

/** 智能体编辑器工具勾选用：内置 + HTTP 工具统一视图，登录即可读 */
const available = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/available',
    tags: ['AI'],
    summary: '获取可用工具列表（智能体编辑器勾选用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiToolInfoDTO), '可用工具列表') },
  }),
  handler: async (c) => c.json(okBody(await listAvailableTools()), 200),
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['AI'],
    summary: '创建 HTTP API 工具',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:tool:manage', audit: { description: '创建 AI HTTP 工具', module: '智能助手' } })] as const,
    request: { body: { content: jsonContent(createAiHttpToolSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiHttpToolDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createHttpTool(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['AI'],
    summary: '更新 HTTP API 工具',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:tool:manage', audit: { description: '更新 AI HTTP 工具', module: '智能助手' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateAiHttpToolSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiHttpToolDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateHttpTool(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['AI'],
    summary: '删除 HTTP API 工具',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:tool:manage', audit: { description: '删除 AI HTTP 工具', module: '智能助手' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteHttpTool(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([list, available, create, update, remove] as const);

export default router;
