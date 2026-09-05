/**
 * 转账/代付管理路由。
 * 发起转账（微信零钱 / 支付宝账户）、四眼审批、查单同步、列表与汇总。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentTransferContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createTransfer,
  approveTransfer,
  getTransfer,
  getTransferSummary,
  listTransfers,
  rejectTransfer,
  syncTransferStatus,
} from '../../services/payment/payment-transfer.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentTransferContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:transfer:list' })],
  handler: async (c) => c.json(okBody(await listTransfers(c.req.valid('query'))), 200),
});

const summaryRoute = defineContractRoute(paymentTransferContract.summary, {
  middleware: [authMiddleware, guard({ permission: 'payment:transfer:list' })],
  handler: async (c) => c.json(okBody(await getTransferSummary(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(paymentTransferContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:transfer:list' })],
  handler: async (c) => c.json(okBody(await getTransfer(c.req.valid('param').id)), 200),
});

const createTransferRoute = defineContractRoute(paymentTransferContract.create, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:transfer:create', audit: { description: '发起转账', module: '支付中心' } }),
    idempotencyGuard({ ttlSeconds: 15 }),
  ],
  handler: async (c) => c.json(okBody(await createTransfer({
    ...c.req.valid('json'),
    idempotencyKey: c.req.valid('header')['x-idempotency-key'],
  }), '转账已受理'), 200),
});

const approveRoute = defineContractRoute(paymentTransferContract.approve, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:transfer:approve', audit: { description: '审批通过转账', module: '支付中心' } }),
  ],
  handler: async (c) => c.json(okBody(await approveTransfer(
    c.req.valid('param').id,
    c.req.valid('json'),
  ), '转账审批通过并已受理'), 200),
});

const rejectRoute = defineContractRoute(paymentTransferContract.reject, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:transfer:approve', audit: { description: '驳回转账', module: '支付中心' } }),
  ],
  handler: async (c) => c.json(okBody(await rejectTransfer(
    c.req.valid('param').id,
    c.req.valid('json'),
  ), '转账已驳回'), 200),
});

const queryRoute = defineContractRoute(paymentTransferContract.query, {
  middleware: [authMiddleware, guard({ permission: 'payment:transfer:list' })],
  handler: async (c) => c.json(okBody(await syncTransferStatus(c.req.valid('param').id), '查单完成'), 200),
});

router.openapiRoutes([
  listRoute,
  summaryRoute,
  detailRoute,
  createTransferRoute,
  approveRoute,
  rejectRoute,
  queryRoute,
] as const);

export default router;
