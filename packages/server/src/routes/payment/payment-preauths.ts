/**
 * 预授权管理路由。
 * 发起冻结（沙箱即时生效）、转支付（生成正式交易并履约）、解冻、列表。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentPreauthContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  capturePreauth,
  createPreauth,
  ensurePreauth,
  listPreauths,
  recoverPreauth,
  releasePreauth,
} from '../../services/payment/payment-preauth.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentPreauthContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:preauth:list' })],
  handler: async (c) => c.json(okBody(await listPreauths(c.req.valid('query'))), 200),
});

const createPreauthRoute = defineContractRoute(paymentPreauthContract.create, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:preauth:manage', audit: { description: '发起预授权冻结', module: '支付中心' } }),
    idempotencyGuard({ ttlSeconds: 10 }),
  ],
  handler: async (c) => c.json(okBody(await createPreauth(c.req.valid('json')), '冻结完成'), 200),
});

const captureRoute = defineContractRoute(paymentPreauthContract.capture, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:preauth:manage', audit: { description: '预授权转支付', module: '支付中心' } }),
    idempotencyGuard({ ttlSeconds: 10 }),
  ],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { applicationId } = c.req.valid('query');
    setAuditBeforeData(c, await ensurePreauth(id, applicationId));
    return c.json(okBody(await capturePreauth(id, applicationId, c.req.valid('json')), '转支付完成'), 200);
  },
});

const releaseRoute = defineContractRoute(paymentPreauthContract.release, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:preauth:manage', audit: { description: '预授权解冻', module: '支付中心' } }),
    idempotencyGuard({ ttlSeconds: 10 }),
  ],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { applicationId } = c.req.valid('query');
    setAuditBeforeData(c, await ensurePreauth(id, applicationId));
    return c.json(okBody(await releasePreauth(id, applicationId), '已解冻'), 200);
  },
});

const recoverRoute = defineContractRoute(paymentPreauthContract.recover, {
  middleware: [authMiddleware, guard({ permission: 'payment:preauth:manage', audit: { description: '查询恢复预授权', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await recoverPreauth(c.req.valid('param').id, c.req.valid('query').applicationId), '查询完成'), 200),
});

router.openapiRoutes([listRoute, createPreauthRoute, captureRoute, releaseRoute, recoverRoute] as const);

export default router;
