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
import { AiAgentDTO } from '../../lib/openapi-dtos';
import {
  listMyAgents,
  listMarketAgents,
  listPendingAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  submitAgentPublish,
  unpublishAgent,
  reviewAgent,
  cloneAgent,
  getAgentDetail,
} from '../../services/ai/ai-agents.service';
import { createAiAgentSchema, updateAiAgentSchema, reviewAiAgentSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listMine = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取我的智能体列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiAgentDTO), '智能体列表') },
  }),
  handler: async (c) => c.json(okBody(await listMyAgents()), 200),
});

const market = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/market',
    tags: ['AI'],
    summary: '智能体市场（已上架）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiAgentDTO), '市场智能体列表') },
  }),
  handler: async (c) => c.json(okBody(await listMarketAgents()), 200),
});

const pending = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/pending',
    tags: ['AI'],
    summary: '待审核智能体列表（管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:agent:review' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiAgentDTO), '待审核列表') },
  }),
  handler: async (c) => c.json(okBody(await listPendingAgents()), 200),
});

const detail = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['AI'],
    summary: '获取智能体详情（本人或已上架）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiAgentDTO, '智能体详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAgentDetail(id)), 200);
  },
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['AI'],
    summary: '创建智能体',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(createAiAgentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiAgentDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createAgent(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['AI'],
    summary: '更新智能体（仅创建者）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(updateAiAgentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiAgentDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateAgent(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['AI'],
    summary: '删除智能体（仅创建者）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteAgent(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const publish = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/publish',
    tags: ['AI'],
    summary: '提交上架审核',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiAgentDTO, '已提交审核') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await submitAgentPublish(id), '已提交审核'), 200);
  },
});

const unpublish = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/unpublish',
    tags: ['AI'],
    summary: '撤回上架 / 取消审核',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiAgentDTO, '已撤回') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await unpublishAgent(id), '已撤回'), 200);
  },
});

const review = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/review',
    tags: ['AI'],
    summary: '审核智能体上架（管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:agent:review', audit: { description: '审核智能体', module: '智能助手' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(reviewAiAgentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiAgentDTO, '审核完成') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { approve } = c.req.valid('json');
    return c.json(okBody(await reviewAgent(id, approve), approve ? '已通过上架' : '已驳回'), 200);
  },
});

const clone = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/clone',
    tags: ['AI'],
    summary: '克隆市场智能体为我的副本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiAgentDTO, '克隆成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await cloneAgent(id), '克隆成功'), 200);
  },
});

router.openapiRoutes([listMine, market, pending, detail, create, update, remove, publish, unpublish, review, clone] as const);

export default router;
