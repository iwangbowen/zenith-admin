import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, BatchIdsBody,
} from '../lib/openapi-schemas';
import { DecisionTableDTO, DecisionTableVersionDTO, RuleEvaluateResultDTO, RuleVersionDiffDTO } from '../lib/openapi-dtos';
import { createDecisionTableSchema, updateDecisionTableSchema } from '@zenith/shared';
import {
  listDecisionTables, getDecisionTable, getDecisionTableBeforeAudit,
  createDecisionTable, updateDecisionTable, deleteDecisionTable, deleteDecisionTables,
  publishDecisionTable, listDecisionTableVersions, evaluateDecisionTableByKey, testEvaluateDecisionTable,
  diffDecisionTableVersions, rollbackDecisionTable,
} from '../services/rules.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['DecisionTables'], summary: '决策表分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['draft', 'published', 'disabled']).optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(DecisionTableDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDecisionTables(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['DecisionTables'], summary: '决策表详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(DecisionTableDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getDecisionTable(c.req.valid('param').id)), 200),
});

const versionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/versions', tags: ['DecisionTables'], summary: '决策表版本列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(DecisionTableVersionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDecisionTableVersions(c.req.valid('param').id)), 200),
});

const diffRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/diff', tags: ['DecisionTables'], summary: '版本对比（0=当前编辑态）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:list' })] as const,
    request: { params: IdParam, query: z.object({ from: z.coerce.number().int(), to: z.coerce.number().int().default(0) }) },
    responses: { ...commonErrorResponses, ...ok(RuleVersionDiffDTO, 'ok') },
  }),
  handler: async (c) => { const { id } = c.req.valid('param'); const { from, to } = c.req.valid('query'); return c.json(okBody(await diffDecisionTableVersions(id, from, to)), 200); },
});

const rollbackRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/rollback/{version}', tags: ['DecisionTables'], summary: '回滚到历史版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '回滚决策表版本', module: '规则中心' } })] as const,
    request: { params: z.object({ id: z.coerce.number().int(), version: z.coerce.number().int() }) },
    responses: { ...commonErrorResponses, ...ok(DecisionTableDTO, '回滚成功') },
  }),
  handler: async (c) => { const { id, version } = c.req.valid('param'); return c.json(okBody(await rollbackDecisionTable(id, version), '回滚成功'), 200); },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['DecisionTables'], summary: '创建决策表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:create', audit: { description: '创建决策表', module: '规则中心' } })] as const,
    request: { body: { content: jsonContent(createDecisionTableSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DecisionTableDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDecisionTable(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['DecisionTables'], summary: '更新决策表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '更新决策表', module: '规则中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateDecisionTableSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DecisionTableDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDecisionTableBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDecisionTable(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const publishRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/publish', tags: ['DecisionTables'], summary: '发布决策表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:publish', audit: { description: '发布决策表', module: '规则中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(DecisionTableDTO, '发布成功') },
  }),
  handler: async (c) => c.json(okBody(await publishDecisionTable(c.req.valid('param').id), '发布成功'), 200),
});

const testRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/test', tags: ['DecisionTables'], summary: '测试求值（编辑态）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:evaluate' })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ input: z.record(z.string(), z.unknown()).default({}) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleEvaluateResultDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await testEvaluateDecisionTable(c.req.valid('param').id, c.req.valid('json').input)), 200),
});

const evaluateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/evaluate', tags: ['DecisionTables'], summary: '按 key 求值（对外通用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:evaluate' })] as const,
    request: { body: { content: jsonContent(z.object({ key: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleEvaluateResultDTO, 'ok') },
  }),
  handler: async (c) => { const b = c.req.valid('json'); return c.json(okBody(await evaluateDecisionTableByKey(b.key, b.input)), 200); },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['DecisionTables'], summary: '批量删除决策表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:delete', audit: { description: '批量删除决策表', module: '规则中心' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => { await deleteDecisionTables(c.req.valid('json').ids); return c.json(okBody(null, '删除成功'), 200); },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['DecisionTables'], summary: '删除决策表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:delete', audit: { description: '删除决策表', module: '规则中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDecisionTableBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDecisionTable(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, getRoute, versionsRoute, diffRoute, rollbackRoute, createRouteDef, updateRoute, publishRoute, testRoute, evaluateRoute, batchDeleteRoute, deleteRoute] as const);

export default router;
