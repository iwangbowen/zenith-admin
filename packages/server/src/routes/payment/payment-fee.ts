import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentFeeRuleContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listFeeRules, getFeeRule, createFeeRule, updateFeeRule, deleteFeeRule } from '../../services/payment/payment-fee.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentFeeRuleContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:fee:list' })],
  handler: async (c) => c.json(okBody(await listFeeRules(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(paymentFeeRuleContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:fee:list' })],
  handler: async (c) => c.json(okBody(await getFeeRule(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(paymentFeeRuleContract.create, {
  middleware: [authMiddleware, guard({ permission: 'payment:fee:create', audit: { description: '新增支付费率规则', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await createFeeRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(paymentFeeRuleContract.update, {
  middleware: [authMiddleware, guard({ permission: 'payment:fee:update', audit: { description: '编辑支付费率规则', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getFeeRule(id));
    return c.json(okBody(await updateFeeRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(paymentFeeRuleContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'payment:fee:delete', audit: { description: '删除支付费率规则', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getFeeRule(id));
    await deleteFeeRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, detailRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default router;
