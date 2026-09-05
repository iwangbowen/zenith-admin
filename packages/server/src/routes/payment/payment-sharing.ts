import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentSharingContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listReceivers,
  getReceiver,
  createReceiver,
  updateReceiver,
  deleteReceiver,
  listSharingOrders,
  dispatchSharing,
} from '../../services/payment/payment-sharing.service';
import {
  createSharingReversal,
  getSharingReversal,
  listSharingReversals,
  querySharingReversal,
} from '../../services/payment/payment-sharing-reversal.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 接收方 CRUD ──────────────────────────────────────────────────────────────
const listReceiversRoute = defineContractRoute(paymentSharingContract.receivers, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:list' })],
  handler: async (c) => c.json(okBody(await listReceivers(c.req.valid('query'))), 200),
});

const receiverDetailRoute = defineContractRoute(paymentSharingContract.receiverDetail, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:list' })],
  handler: async (c) => c.json(okBody(await getReceiver(c.req.valid('param').id)), 200),
});

const createReceiverRoute = defineContractRoute(paymentSharingContract.createReceiver, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:manage', audit: { description: '新增分账接收方', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await createReceiver(c.req.valid('json')), '创建成功'), 200),
});

const updateReceiverRoute = defineContractRoute(paymentSharingContract.updateReceiver, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:manage', audit: { description: '编辑分账接收方', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getReceiver(id));
    return c.json(okBody(await updateReceiver(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteReceiverRoute = defineContractRoute(paymentSharingContract.removeReceiver, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:manage', audit: { description: '删除分账接收方', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getReceiver(id));
    await deleteReceiver(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 分账单 ───────────────────────────────────────────────────────────────────
const listOrdersRoute = defineContractRoute(paymentSharingContract.orders, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:list' })],
  handler: async (c) => c.json(okBody(await listSharingOrders(c.req.valid('query'))), 200),
});

const dispatchRoute = defineContractRoute(paymentSharingContract.dispatch, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:dispatch', audit: { description: '发起支付分账', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await dispatchSharing(c.req.valid('json')), '分账已发起'), 200),
});

const reversalListRoute = defineContractRoute(paymentSharingContract.reversals, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:list' })],
  handler: async (c) => c.json(okBody(await listSharingReversals(c.req.valid('query'))), 200),
});

const reversalDetailRoute = defineContractRoute(paymentSharingContract.reversalDetail, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:list' })],
  handler: async (c) => c.json(okBody(await getSharingReversal(c.req.valid('param').id)), 200),
});

const reversalCreateRoute = defineContractRoute(paymentSharingContract.reverse, {
  middleware: [
    authMiddleware,
    idempotencyGuard({ ttlSeconds: 15, message: '分账冲正处理中，请勿重复提交' }),
    guard({ permission: 'payment:sharing:dispatch', audit: { description: '发起支付分账冲正', module: '支付中心' } }),
  ],
  handler: async (c) => c.json(okBody(await createSharingReversal({
    sharingOrderId: c.req.valid('param').id,
    idempotencyKey: c.req.valid('header')['x-idempotency-key'],
    reason: c.req.valid('json').reason,
  }), '冲正已受理'), 200),
});

const reversalQueryRoute = defineContractRoute(paymentSharingContract.queryReversal, {
  middleware: [authMiddleware, guard({ permission: 'payment:sharing:dispatch', audit: { description: '查询支付分账冲正', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await querySharingReversal(c.req.valid('param').id), '查单完成'), 200),
});

router.openapiRoutes([
  listReceiversRoute,
  receiverDetailRoute,
  createReceiverRoute,
  updateReceiverRoute,
  deleteReceiverRoute,
  listOrdersRoute,
  dispatchRoute,
  reversalListRoute,
  reversalCreateRoute,
  reversalQueryRoute,
  reversalDetailRoute,
] as const);

export default router;
