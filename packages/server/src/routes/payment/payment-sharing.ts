import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentSharingContract } from '@zenith/shared/payment';
import { setAuditBeforeData } from '../../middleware/guard';
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
  getSharingOrder,
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
  handler: async (c) => c.json(okBody(await listReceivers(c.req.valid('query'))), 200),
});

const receiverDetailRoute = defineContractRoute(paymentSharingContract.receiverDetail, {
  handler: async (c) => c.json(okBody(await getReceiver(c.req.valid('param').id)), 200),
});

const createReceiverRoute = defineContractRoute(paymentSharingContract.createReceiver, {
  handler: async (c) => c.json(okBody(await createReceiver(c.req.valid('json')), '创建成功'), 200),
});

const updateReceiverRoute = defineContractRoute(paymentSharingContract.updateReceiver, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getReceiver(id));
    return c.json(okBody(await updateReceiver(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteReceiverRoute = defineContractRoute(paymentSharingContract.removeReceiver, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getReceiver(id));
    await deleteReceiver(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 分账单 ───────────────────────────────────────────────────────────────────
const listOrdersRoute = defineContractRoute(paymentSharingContract.orders, {
  handler: async (c) => c.json(okBody(await listSharingOrders(c.req.valid('query'))), 200),
});
const orderDetailRoute = defineContractRoute(paymentSharingContract.orderDetail, {
  handler: async (c) => c.json(okBody(await getSharingOrder(c.req.valid('param').id)), 200),
});

const dispatchRoute = defineContractRoute(paymentSharingContract.dispatch, {
  handler: async (c) => c.json(okBody(await dispatchSharing(c.req.valid('json')), '分账已发起'), 200),
});

const reversalListRoute = defineContractRoute(paymentSharingContract.reversals, {
  handler: async (c) => c.json(okBody(await listSharingReversals(c.req.valid('query'))), 200),
});

const reversalDetailRoute = defineContractRoute(paymentSharingContract.reversalDetail, {
  handler: async (c) => c.json(okBody(await getSharingReversal(c.req.valid('param').id)), 200),
});

const reversalCreateRoute = defineContractRoute(paymentSharingContract.reverse, {
  middleware: [idempotencyGuard({ ttlSeconds: 15, message: '分账冲正处理中，请勿重复提交' })],
  handler: async (c) => c.json(okBody(await createSharingReversal({
    sharingOrderId: c.req.valid('param').id,
    idempotencyKey: c.req.valid('header')['x-idempotency-key'],
    reason: c.req.valid('json').reason,
  }), '冲正已受理'), 200),
});

const reversalQueryRoute = defineContractRoute(paymentSharingContract.queryReversal, {
  handler: async (c) => c.json(okBody(await querySharingReversal(c.req.valid('param').id), '查单完成'), 200),
});

router.openapiRoutes([
  orderDetailRoute,
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
