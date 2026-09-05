import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentReconContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listReconBatches,
  getReconBatch,
  listReconItems,
  createReconBatch,
  deleteReconBatch,
  generateSampleBill,
  handleReconItem,
  autoReconcileForCurrentUser,
} from '../../services/payment/payment-recon.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentReconContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:recon:list' })],
  handler: async (c) => c.json(okBody(await listReconBatches(c.req.valid('query'))), 200),
});

const createBatchRoute = defineContractRoute(paymentReconContract.create, {
  middleware: [authMiddleware, guard({ permission: 'payment:recon:create', audit: { description: '创建支付对账批次', module: '支付中心', recordBody: false } })],
  handler: async (c) => c.json(okBody(await createReconBatch(c.req.valid('json')), '对账完成'), 200),
});

const sampleRoute = defineContractRoute(paymentReconContract.sampleBill, {
  middleware: [authMiddleware, guard({ permission: 'payment:recon:create' })],
  handler: async (c) => {
    const { applicationId, channel, channelConfigId, currency, billDate } = c.req.valid('query');
    return c.json(okBody({ billText: await generateSampleBill({ applicationId, channel, channelConfigId, currency, billDate }) }), 200);
  },
});

const detailRoute = defineContractRoute(paymentReconContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:recon:list' })],
  handler: async (c) => c.json(okBody(await getReconBatch(c.req.valid('param').id)), 200),
});

const itemsRoute = defineContractRoute(paymentReconContract.items, {
  middleware: [authMiddleware, guard({ permission: 'payment:recon:list' })],
  handler: async (c) => c.json(okBody(await listReconItems(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const autoRoute = defineContractRoute(paymentReconContract.auto, {
  middleware: [authMiddleware, guard({ permission: 'payment:recon:create', audit: { description: '自动拉取渠道账单对账', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await autoReconcileForCurrentUser(c.req.valid('json')), '对账完成'), 200),
});

const handleItemRoute = defineContractRoute(paymentReconContract.handleItem, {
  middleware: [authMiddleware, guard({ permission: 'payment:recon:handle', audit: { description: '处理支付对账差异', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await handleReconItem(c.req.valid('param').id, c.req.valid('json')), '处理成功'), 200),
});

const deleteRoute = defineContractRoute(paymentReconContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'payment:recon:delete', audit: { description: '删除支付对账批次', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getReconBatch(id));
    await deleteReconBatch(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createBatchRoute, sampleRoute, autoRoute, detailRoute, itemsRoute, handleItemRoute, deleteRoute] as const);

export default router;
