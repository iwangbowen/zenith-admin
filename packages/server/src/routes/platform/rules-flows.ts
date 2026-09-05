import { OpenAPIHono } from '@hono/zod-openapi';
import { decisionFlowContract } from '@zenith/shared/rules';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDecisionFlows, getDecisionFlow, getDecisionFlowBeforeAudit,
  createDecisionFlow, updateDecisionFlow, deleteDecisionFlow, deleteDecisionFlows,
  toggleDecisionFlow, publishDecisionFlow, testEvaluateDecisionFlow, evaluateDecisionFlowByKey,
  listDecisionFlowVersions, rollbackDecisionFlow,
} from '../../services/platform/rules-flow.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'rule:flow:list' })] as const;

const versionsRoute = defineContractRoute(decisionFlowContract.versions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDecisionFlowVersions(c.req.valid('param').id)), 200),
});

const rollbackRoute = defineContractRoute(decisionFlowContract.rollback, {
  middleware: [authMiddleware, guard({ permission: 'rule:flow:update', audit: { description: '回滚决策流版本', module: '规则中心' } })],
  handler: async (c) => {
    const { id, version } = c.req.valid('param');
    return c.json(okBody(await rollbackDecisionFlow(id, version), '回滚成功'), 200);
  },
});

const listRoute = defineContractRoute(decisionFlowContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDecisionFlows(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(decisionFlowContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getDecisionFlow(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(decisionFlowContract.create, {
  middleware: [authMiddleware, guard({ permission: 'rule:flow:create', audit: { description: '创建决策流', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await createDecisionFlow(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(decisionFlowContract.update, {
  middleware: [authMiddleware, guard({ permission: 'rule:flow:update', audit: { description: '更新决策流', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDecisionFlowBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDecisionFlow(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const publishRoute = defineContractRoute(decisionFlowContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'rule:flow:publish', audit: { description: '发布决策流', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await publishDecisionFlow(c.req.valid('param').id), '发布成功'), 200),
});

const toggleRoute = defineContractRoute(decisionFlowContract.toggle, {
  middleware: [authMiddleware, guard({ permission: 'rule:flow:publish', audit: { description: '启用/停用决策流', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    return c.json(okBody(await toggleDecisionFlow(id, enabled), enabled ? '已启用' : '已停用'), 200);
  },
});

const testRoute = defineContractRoute(decisionFlowContract.test, {
  middleware: [authMiddleware, guard({ permission: 'rule:flow:evaluate' })],
  handler: async (c) => c.json(okBody(await testEvaluateDecisionFlow(c.req.valid('param').id, c.req.valid('json').input)), 200),
});

const evaluateRoute = defineContractRoute(decisionFlowContract.evaluate, {
  middleware: [authMiddleware, sensitiveRateLimit, guard({ permission: 'rule:flow:evaluate' })],
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await evaluateDecisionFlowByKey(b.key, b.input)), 200);
  },
});

const batchDeleteRoute = defineContractRoute(decisionFlowContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'rule:flow:delete', audit: { description: '批量删除决策流', module: '规则中心' } })],
  handler: async (c) => {
    await deleteDecisionFlows(c.req.valid('json').ids);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const deleteRoute = defineContractRoute(decisionFlowContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'rule:flow:delete', audit: { description: '删除决策流', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDecisionFlowBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDecisionFlow(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, getRoute, versionsRoute, rollbackRoute, createRouteDef, updateRoute, publishRoute, toggleRoute, testRoute, evaluateRoute, batchDeleteRoute, deleteRoute] as const);

export default router;
