import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, BatchIdsBody,
} from '../../lib/openapi-schemas';
import { DecisionTableDTO, DecisionTableVersionDTO, RuleEvaluateResultDTO, RuleVersionDiffDTO, RuleTestCaseDTO, RuleTestRunResultDTO, RuleExecutionDTO, RuleUsageDTO } from '../../lib/openapi-dtos';
import { createDecisionTableSchema, updateDecisionTableSchema, createRuleTestCaseSchema, updateRuleTestCaseSchema, toggleDecisionTableSchema } from '@zenith/shared';
import {
  listDecisionTables, getDecisionTable, getDecisionTableBeforeAudit,
  createDecisionTable, updateDecisionTable, deleteDecisionTable, deleteDecisionTables,
  publishDecisionTable, listDecisionTableVersions, evaluateDecisionTableByKey, testEvaluateDecisionTable,
  diffDecisionTableVersions, rollbackDecisionTable, toggleDecisionTable, listDecisionTableUsages,
  listTestCases, createTestCase, updateTestCase, deleteTestCase, runTestCases, listDecisionExecutions,
} from '../../services/platform/rules.service';

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

const usagesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/usages', tags: ['DecisionTables'], summary: '决策表引用分析（where-used）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(RuleUsageDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDecisionTableUsages(c.req.valid('param').id)), 200),
});

const casesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/cases', tags: ['DecisionTables'], summary: '测试用例列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(RuleTestCaseDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listTestCases(c.req.valid('param').id)), 200),
});

const caseCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/cases', tags: ['DecisionTables'], summary: '新增测试用例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '新增决策表用例', module: '规则中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createRuleTestCaseSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleTestCaseDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createTestCase(c.req.valid('param').id, c.req.valid('json')), '创建成功'), 200),
});

const caseRunRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/cases/run', tags: ['DecisionTables'], summary: '批量运行用例（覆盖率）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:evaluate' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(RuleTestRunResultDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await runTestCases(c.req.valid('param').id)), 200),
});

const caseUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/cases/{caseId}', tags: ['DecisionTables'], summary: '更新测试用例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '更新决策表用例', module: '规则中心' } })] as const,
    request: { params: z.object({ id: z.coerce.number().int(), caseId: z.coerce.number().int() }), body: { content: jsonContent(updateRuleTestCaseSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleTestCaseDTO, '更新成功') },
  }),
  handler: async (c) => { const { id, caseId } = c.req.valid('param'); return c.json(okBody(await updateTestCase(id, caseId, c.req.valid('json')), '更新成功'), 200); },
});

const caseDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}/cases/{caseId}', tags: ['DecisionTables'], summary: '删除测试用例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '删除决策表用例', module: '规则中心' } })] as const,
    request: { params: z.object({ id: z.coerce.number().int(), caseId: z.coerce.number().int() }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => { const { id, caseId } = c.req.valid('param'); await deleteTestCase(id, caseId); return c.json(okBody(null, '删除成功'), 200); },
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

const toggleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/toggle', tags: ['DecisionTables'], summary: '启用/停用决策表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:publish', audit: { description: '启用/停用决策表', module: '规则中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(toggleDecisionTableSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DecisionTableDTO, '操作成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    const before = await getDecisionTableBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await toggleDecisionTable(id, enabled), enabled ? '已启用' : '已停用'), 200);
  },
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

const executionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/executions', tags: ['DecisionTables'], summary: '决策执行记录（trace/审计，分页）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:table:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        instanceId: z.coerce.number().int().optional(),
        tableId: z.coerce.number().int().optional(),
        ruleKey: z.string().optional(),
        source: z.enum(['runtime', 'manual', 'test']).optional(),
        matched: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
        dateStart: z.string().optional(),
        dateEnd: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(RuleExecutionDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDecisionExecutions(c.req.valid('query'))), 200),
});

router.openapiRoutes([listRoute, executionsRoute, getRoute, versionsRoute, diffRoute, rollbackRoute, usagesRoute, casesRoute, caseCreateRoute, caseRunRoute, caseUpdateRoute, caseDeleteRoute, createRouteDef, updateRoute, publishRoute, toggleRoute, testRoute, evaluateRoute, batchDeleteRoute, deleteRoute] as const);

export default router;
