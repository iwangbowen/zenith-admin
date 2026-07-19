import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, BatchIdsBody,
} from '../../lib/openapi-schemas';
import { DecisionFlowDTO, RuleFlowEvaluateResultDTO } from '../../lib/openapi-dtos';
import { createDecisionFlowSchema, updateDecisionFlowSchema, toggleDecisionTableSchema } from '@zenith/shared';
import {
  listDecisionFlows, getDecisionFlow, getDecisionFlowBeforeAudit,
  createDecisionFlow, updateDecisionFlow, deleteDecisionFlow, deleteDecisionFlows,
  toggleDecisionFlow, publishDecisionFlow, testEvaluateDecisionFlow, evaluateDecisionFlowByKey,
} from '../../services/platform/rules-flow.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['DecisionFlows'], summary: '决策流分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['draft', 'published', 'disabled']).optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(DecisionFlowDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDecisionFlows(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['DecisionFlows'], summary: '决策流详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(DecisionFlowDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getDecisionFlow(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['DecisionFlows'], summary: '创建决策流',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:create', audit: { description: '创建决策流', module: '规则中心' } })] as const,
    request: { body: { content: jsonContent(createDecisionFlowSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DecisionFlowDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDecisionFlow(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['DecisionFlows'], summary: '更新决策流',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:update', audit: { description: '更新决策流', module: '规则中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateDecisionFlowSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DecisionFlowDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDecisionFlowBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDecisionFlow(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const publishRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/publish', tags: ['DecisionFlows'], summary: '发布决策流（步骤固化为运行时快照）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:publish', audit: { description: '发布决策流', module: '规则中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(DecisionFlowDTO, '发布成功') },
  }),
  handler: async (c) => c.json(okBody(await publishDecisionFlow(c.req.valid('param').id), '发布成功'), 200),
});

const toggleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/toggle', tags: ['DecisionFlows'], summary: '启用/停用决策流',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:publish', audit: { description: '启用/停用决策流', module: '规则中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(toggleDecisionTableSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DecisionFlowDTO, '操作成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    return c.json(okBody(await toggleDecisionFlow(id, enabled), enabled ? '已启用' : '已停用'), 200);
  },
});

const testRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/test', tags: ['DecisionFlows'], summary: '测试求值（编辑态步骤，逐步 trace）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:evaluate' })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ input: z.record(z.string(), z.unknown()).default({}) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleFlowEvaluateResultDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await testEvaluateDecisionFlow(c.req.valid('param').id, c.req.valid('json').input)), 200),
});

const evaluateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/evaluate', tags: ['DecisionFlows'], summary: '按 key 求值（对外通用，支持 zat_ API Token 调用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, sensitiveRateLimit, guard({ permission: 'rule:flow:evaluate' })] as const,
    request: { body: { content: jsonContent(z.object({ key: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleFlowEvaluateResultDTO, 'ok') },
  }),
  handler: async (c) => { const b = c.req.valid('json'); return c.json(okBody(await evaluateDecisionFlowByKey(b.key, b.input)), 200); },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['DecisionFlows'], summary: '批量删除决策流',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:delete', audit: { description: '批量删除决策流', module: '规则中心' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => { await deleteDecisionFlows(c.req.valid('json').ids); return c.json(okBody(null, '删除成功'), 200); },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['DecisionFlows'], summary: '删除决策流',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:flow:delete', audit: { description: '删除决策流', module: '规则中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDecisionFlowBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDecisionFlow(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, publishRoute, toggleRoute, testRoute, evaluateRoute, batchDeleteRoute, deleteRoute] as const);

export default router;
