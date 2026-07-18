import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okPaginated,
  IdParam,
  okBody,
  PaginationQuery,
} from '../../lib/openapi-schemas';
import { AiPromptTemplateDTO, AiPromptTemplateVersionDTO } from '../../lib/openapi-dtos';
import {
  listPromptTemplates,
  listChatPromptTemplates,
  getPromptTemplate,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  incrementPromptUsage,
  listPromptTemplateVersions,
  restorePromptTemplateVersion,
} from '../../services/ai/ai-prompt-templates.service';
import { createAiPromptTemplateSchema, updateAiPromptTemplateSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ListQuery = PaginationQuery.extend({
  scope: z.enum(['system', 'user']).optional().openapi({ description: '范围筛选：system / user' }),
  keyword: z.string().max(100).optional().openapi({ description: '搜索关键词（名称或描述）' }),
});

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取提示词模板列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:prompt:list' })] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(AiPromptTemplateDTO, '模板列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, scope, keyword } = c.req.valid('query');
    return c.json(okBody(await listPromptTemplates({ page, pageSize, scope, keyword })), 200);
  },
});

const available = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/available',
    tags: ['AI'],
    summary: '获取可用提示词模板（聊天选择器用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiPromptTemplateDTO), '可用模板列表') },
  }),
  handler: async (c) => c.json(okBody(await listChatPromptTemplates()), 200),
});

const use = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/use',
    tags: ['AI'],
    summary: '记录模板被应用为对话角色一次（使用统计）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已记录') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await incrementPromptUsage(id);
    return c.json(okBody(null, '已记录'), 200);
  },
});

const getOne = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['AI'],
    summary: '获取提示词模板详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:prompt:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiPromptTemplateDTO, '模板详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getPromptTemplate(id)), 200);
  },
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['AI'],
    summary: '创建提示词模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:prompt:create' })] as const,
    request: { body: { content: jsonContent(createAiPromptTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiPromptTemplateDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createPromptTemplate(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['AI'],
    summary: '更新提示词模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:prompt:edit' })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateAiPromptTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiPromptTemplateDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updatePromptTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['AI'],
    summary: '删除提示词模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:prompt:delete' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deletePromptTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const versions = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/versions',
    tags: ['AI'],
    summary: '获取提示词模板历史版本列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:prompt:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(AiPromptTemplateVersionDTO), '历史版本列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listPromptTemplateVersions(id)), 200);
  },
});

const restoreVersion = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/versions/{versionId}/restore',
    tags: ['AI'],
    summary: '恢复到指定历史版本（当前内容自动留档）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:prompt:edit', audit: { description: '恢复提示词模板版本', module: '智能助手' } })] as const,
    request: { params: z.object({ id: z.coerce.number(), versionId: z.coerce.number() }) },
    responses: { ...commonErrorResponses, ...ok(AiPromptTemplateDTO, '恢复成功') },
  }),
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    return c.json(okBody(await restorePromptTemplateVersion(id, versionId), '已恢复到历史版本'), 200);
  },
});

router.openapiRoutes([list, available, use, getOne, versions, restoreVersion, create, update, remove] as const);

export default router;
