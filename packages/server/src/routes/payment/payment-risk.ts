import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentRiskRuleContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listRiskRules, getRiskRule, createRiskRule, updateRiskRule, deleteRiskRule } from '../../services/payment/payment-risk.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentRiskRuleContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:list' })],
  handler: async (c) => c.json(okBody(await listRiskRules(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(paymentRiskRuleContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:list' })],
  handler: async (c) => c.json(okBody(await getRiskRule(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(paymentRiskRuleContract.create, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:create', audit: { description: '新增支付风控规则', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await createRiskRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(paymentRiskRuleContract.update, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:update', audit: { description: '编辑支付风控规则', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRiskRule(id));
    return c.json(okBody(await updateRiskRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(paymentRiskRuleContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:delete', audit: { description: '删除支付风控规则', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRiskRule(id));
    await deleteRiskRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, detailRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default router;
