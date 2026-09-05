import { OpenAPIHono } from '@hono/zod-openapi';
import { decisionTableContract } from '@zenith/shared/rules';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDecisionTables, getDecisionTable, getDecisionTableBeforeAudit,
  createDecisionTable, updateDecisionTable, deleteDecisionTable, deleteDecisionTables,
  publishDecisionTable, listDecisionTableVersions, evaluateDecisionTableByKey, testEvaluateDecisionTable,
  diffDecisionTableVersions, rollbackDecisionTable, toggleDecisionTable, listDecisionTableUsages,
  listTestCases, createTestCase, updateTestCase, deleteTestCase, runTestCases,
  getDecisionTableStats, shadowRunDecisionTable, submitDecisionTableReview, reviewDecisionTable,
  grayActionDecisionTable, simulateDecisionTable,
} from '../../services/platform/rules.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'rule:table:list' })] as const;
const evaluate = [authMiddleware, guard({ permission: 'rule:table:evaluate' })] as const;

const listRoute = defineContractRoute(decisionTableContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDecisionTables(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(decisionTableContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getDecisionTable(c.req.valid('param').id)), 200),
});

const versionsRoute = defineContractRoute(decisionTableContract.versions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDecisionTableVersions(c.req.valid('param').id)), 200),
});

const diffRoute = defineContractRoute(decisionTableContract.diff, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { from, to } = c.req.valid('query');
    return c.json(okBody(await diffDecisionTableVersions(id, from, to)), 200);
  },
});

const rollbackRoute = defineContractRoute(decisionTableContract.rollback, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '回滚决策表版本', module: '规则中心' } })],
  handler: async (c) => {
    const { id, version } = c.req.valid('param');
    return c.json(okBody(await rollbackDecisionTable(id, version), '回滚成功'), 200);
  },
});

const usagesRoute = defineContractRoute(decisionTableContract.usages, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDecisionTableUsages(c.req.valid('param').id)), 200),
});

const casesRoute = defineContractRoute(decisionTableContract.cases, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listTestCases(c.req.valid('param').id)), 200),
});

const caseCreateRoute = defineContractRoute(decisionTableContract.createCase, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '新增决策表用例', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await createTestCase(c.req.valid('param').id, c.req.valid('json')), '创建成功'), 200),
});

const caseRunRoute = defineContractRoute(decisionTableContract.runCases, {
  middleware: evaluate,
  handler: async (c) => c.json(okBody(await runTestCases(c.req.valid('param').id)), 200),
});

const caseUpdateRoute = defineContractRoute(decisionTableContract.updateCase, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '更新决策表用例', module: '规则中心' } })],
  handler: async (c) => {
    const { id, caseId } = c.req.valid('param');
    return c.json(okBody(await updateTestCase(id, caseId, c.req.valid('json')), '更新成功'), 200);
  },
});

const caseDeleteRoute = defineContractRoute(decisionTableContract.removeCase, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '删除决策表用例', module: '规则中心' } })],
  handler: async (c) => {
    const { id, caseId } = c.req.valid('param');
    await deleteTestCase(id, caseId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createRouteDef = defineContractRoute(decisionTableContract.create, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:create', audit: { description: '创建决策表', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await createDecisionTable(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(decisionTableContract.update, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:update', audit: { description: '更新决策表', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDecisionTableBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDecisionTable(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const publishRoute = defineContractRoute(decisionTableContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:publish', audit: { description: '发布决策表', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const gray = body.grayPercent != null ? { grayPercent: body.grayPercent, grayDimension: body.grayDimension ?? null } : undefined;
    return c.json(okBody(await publishDecisionTable(id, { gray }), gray ? `已灰度发布（${gray.grayPercent}% 流量）` : '发布成功'), 200);
  },
});

const grayActionRoute = defineContractRoute(decisionTableContract.grayAction, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:publish', audit: { description: '决策表灰度操作', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { action } = c.req.valid('json');
    return c.json(okBody(await grayActionDecisionTable(id, action), action === 'complete' ? '灰度已转正，新版本全量生效' : '已放弃灰度，全量回到旧版本'), 200);
  },
});

const simulateRoute = defineContractRoute(decisionTableContract.simulate, {
  middleware: evaluate,
  handler: async (c) => c.json(okBody(await simulateDecisionTable(c.req.valid('param').id, c.req.valid('json').rows)), 200),
});

const toggleRoute = defineContractRoute(decisionTableContract.toggle, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:publish', audit: { description: '启用/停用决策表', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    const before = await getDecisionTableBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await toggleDecisionTable(id, enabled), enabled ? '已启用' : '已停用'), 200);
  },
});

const statsRoute = defineContractRoute(decisionTableContract.stats, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getDecisionTableStats(id, c.req.valid('query').days)), 200);
  },
});

const shadowRunRoute = defineContractRoute(decisionTableContract.shadowRun, {
  middleware: evaluate,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await shadowRunDecisionTable(id, c.req.valid('json').limit)), 200);
  },
});

const submitReviewRoute = defineContractRoute(decisionTableContract.submitReview, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:publish', audit: { description: '申请发布决策表', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await submitDecisionTableReview(c.req.valid('param').id), '已提交审批'), 200),
});

const reviewRoute = defineContractRoute(decisionTableContract.review, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:approve', audit: { description: '审批决策表发布', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { approve, comment } = c.req.valid('json');
    return c.json(okBody(await reviewDecisionTable(id, approve, comment), approve ? '已批准并发布' : '已驳回'), 200);
  },
});

const testRoute = defineContractRoute(decisionTableContract.test, {
  middleware: evaluate,
  handler: async (c) => c.json(okBody(await testEvaluateDecisionTable(c.req.valid('param').id, c.req.valid('json').input)), 200),
});

const evaluateRoute = defineContractRoute(decisionTableContract.evaluate, {
  middleware: [authMiddleware, sensitiveRateLimit, guard({ permission: 'rule:table:evaluate' })],
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await evaluateDecisionTableByKey(b.key, b.input)), 200);
  },
});

const batchDeleteRoute = defineContractRoute(decisionTableContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:delete', audit: { description: '批量删除决策表', module: '规则中心' } })],
  handler: async (c) => {
    await deleteDecisionTables(c.req.valid('json').ids);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const deleteRoute = defineContractRoute(decisionTableContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:delete', audit: { description: '删除决策表', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDecisionTableBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDecisionTable(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, getRoute, versionsRoute, diffRoute, rollbackRoute, usagesRoute, statsRoute, shadowRunRoute, submitReviewRoute, reviewRoute, casesRoute, caseCreateRoute, caseRunRoute, caseUpdateRoute, caseDeleteRoute, createRouteDef, updateRoute, publishRoute, grayActionRoute, simulateRoute, toggleRoute, testRoute, evaluateRoute, batchDeleteRoute, deleteRoute] as const);

export default router;
