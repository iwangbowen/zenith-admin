import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentSettlementContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listSettlements, getSettlement, listSettlementItems, generateSettlement, transitionSettlement, deleteSettlement } from '../../services/payment/payment-settlement.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentSettlementContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:settlement:list' })],
  handler: async (c) => c.json(okBody(await listSettlements(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(paymentSettlementContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:settlement:list' })],
  handler: async (c) => c.json(okBody(await getSettlement(c.req.valid('param').id)), 200),
});

const itemsRoute = defineContractRoute(paymentSettlementContract.items, {
  middleware: [authMiddleware, guard({ permission: 'payment:settlement:list' })],
  handler: async (c) => c.json(okBody(await listSettlementItems(c.req.valid('param').id)), 200),
});

const generateRoute = defineContractRoute(paymentSettlementContract.generate, {
  middleware: [authMiddleware, guard({ permission: 'payment:settlement:generate', audit: { description: '生成支付结算批次', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await generateSettlement(c.req.valid('json')), '生成成功'), 200),
});

const transitionRoute = defineContractRoute(paymentSettlementContract.transition, {
  middleware: [authMiddleware, guard({ permission: 'payment:settlement:settle', audit: { description: '流转支付结算批次状态', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSettlement(id));
    return c.json(okBody(await transitionSettlement(id, c.req.valid('json')), '流转成功'), 200);
  },
});

const deleteRoute = defineContractRoute(paymentSettlementContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'payment:settlement:settle', audit: { description: '删除支付结算批次', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSettlement(id));
    await deleteSettlement(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, itemsRoute, detailRoute, generateRoute, transitionRoute, deleteRoute] as const);

export default router;
