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
import { AiEvalSetDTO, AiEvalRunDTO, AsyncTaskDTO } from '../../lib/openapi-dtos';
import {
  listEvalSets,
  createEvalSet,
  updateEvalSet,
  deleteEvalSet,
  listEvalRuns,
  getEvalRun,
  submitEvalRun,
  deleteEvalRun,
} from '../../services/ai/ai-eval.service';
import { createAiEvalSetSchema, updateAiEvalSetSchema, runAiEvalSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listSets = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/sets',
    tags: ['AI'],
    summary: '获取评测集列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:eval:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiEvalSetDTO), '评测集列表') },
  }),
  handler: async (c) => c.json(okBody(await listEvalSets()), 200),
});

const createSet = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/sets',
    tags: ['AI'],
    summary: '创建评测集',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:eval:manage', audit: { description: '创建 AI 评测集', module: '智能助手' } })] as const,
    request: { body: { content: jsonContent(createAiEvalSetSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiEvalSetDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createEvalSet(c.req.valid('json')), '创建成功'), 200),
});

const updateSet = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/sets/{id}',
    tags: ['AI'],
    summary: '更新评测集',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:eval:manage' })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateAiEvalSetSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiEvalSetDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateEvalSet(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const removeSet = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/sets/{id}',
    tags: ['AI'],
    summary: '删除评测集（级联删除运行记录）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:eval:manage', audit: { description: '删除 AI 评测集', module: '智能助手' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteEvalSet(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const runEval = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/sets/{id}/run',
    tags: ['AI'],
    summary: '运行评测（任务中心异步执行）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:eval:manage', audit: { description: '运行 AI 评测', module: '智能助手' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(runAiEvalSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.object({ run: AiEvalRunDTO, task: AsyncTaskDTO }), '任务已提交') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await submitEvalRun(id, c.req.valid('json')), '评测任务已提交'), 200);
  },
});

const RunsQuery = z.object({
  setId: z.coerce.number().int().positive().optional().openapi({ description: '按评测集过滤' }),
});

const listRuns = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/runs',
    tags: ['AI'],
    summary: '获取评测运行列表（最近 100 次）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:eval:list' })] as const,
    request: { query: RunsQuery },
    responses: { ...commonErrorResponses, ...ok(z.array(AiEvalRunDTO), '运行列表') },
  }),
  handler: async (c) => {
    const { setId } = c.req.valid('query');
    return c.json(okBody(await listEvalRuns(setId)), 200);
  },
});

const runDetail = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/runs/{id}',
    tags: ['AI'],
    summary: '获取评测运行详情（含逐条结果）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:eval:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiEvalRunDTO, '运行详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getEvalRun(id)), 200);
  },
});

const removeRun = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/runs/{id}',
    tags: ['AI'],
    summary: '删除评测运行记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:eval:manage' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteEvalRun(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listSets, createSet, updateSet, removeSet, runEval, listRuns, runDetail, removeRun] as const);

export default router;
