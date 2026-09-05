import { OpenAPIHono } from '@hono/zod-openapi';
import { ruleScorecardContract } from '@zenith/shared/rules';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRuleScorecards, getRuleScorecard, createRuleScorecard, updateRuleScorecard, deleteRuleScorecard,
  publishRuleScorecard, toggleRuleScorecard, testEvaluateRuleScorecard, evaluateRuleScorecardByKey,
  ensureRuleScorecard, mapRuleScorecard, listRuleScorecardVersions, rollbackRuleScorecard,
} from '../../services/platform/rules-scorecards.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'rule:scorecard:list' })] as const;
const evaluate = [authMiddleware, guard({ permission: 'rule:scorecard:evaluate' })] as const;

const versionsRoute = defineContractRoute(ruleScorecardContract.versions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listRuleScorecardVersions(c.req.valid('param').id)), 200),
});

const rollbackRoute = defineContractRoute(ruleScorecardContract.rollback, {
  middleware: [authMiddleware, guard({ permission: 'rule:scorecard:update', audit: { description: '回滚评分卡版本', module: '规则中心' } })],
  handler: async (c) => {
    const { id, version } = c.req.valid('param');
    return c.json(okBody(await rollbackRuleScorecard(id, version), '回滚成功'), 200);
  },
});

const listRoute = defineContractRoute(ruleScorecardContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listRuleScorecards(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(ruleScorecardContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getRuleScorecard(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(ruleScorecardContract.create, {
  middleware: [authMiddleware, guard({ permission: 'rule:scorecard:create', audit: { description: '创建评分卡', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await createRuleScorecard(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(ruleScorecardContract.update, {
  middleware: [authMiddleware, guard({ permission: 'rule:scorecard:update', audit: { description: '更新评分卡', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureRuleScorecard(id).then((r) => mapRuleScorecard(r)).catch(() => null);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateRuleScorecard(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(ruleScorecardContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'rule:scorecard:delete', audit: { description: '删除评分卡', module: '规则中心' } })],
  handler: async (c) => {
    await deleteRuleScorecard(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const publishRoute = defineContractRoute(ruleScorecardContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'rule:scorecard:publish', audit: { description: '发布评分卡', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await publishRuleScorecard(c.req.valid('param').id), '发布成功'), 200),
});

const toggleRoute = defineContractRoute(ruleScorecardContract.toggle, {
  middleware: [authMiddleware, guard({ permission: 'rule:scorecard:update', audit: { description: '启停评分卡', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await toggleRuleScorecard(c.req.valid('param').id, c.req.valid('json').enabled)), 200),
});

const evaluateRoute = defineContractRoute(ruleScorecardContract.evaluate, {
  middleware: evaluate,
  handler: async (c) => c.json(okBody(await testEvaluateRuleScorecard(c.req.valid('param').id, c.req.valid('json').input)), 200),
});

const evaluateByKeyRoute = defineContractRoute(ruleScorecardContract.evaluateByKey, {
  middleware: evaluate,
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await evaluateRuleScorecardByKey(b.key, b.input)), 200);
  },
});

router.openapiRoutes([
  listRoute,
  evaluateByKeyRoute,
  createRouteDef,
  versionsRoute,
  rollbackRoute,
  detailRoute,
  updateRoute,
  deleteRoute,
  publishRoute,
  toggleRoute,
  evaluateRoute,
] as const);

export default router;
