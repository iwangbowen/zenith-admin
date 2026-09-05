/** 支付开放 API：全部租户与应用上下文来自 openPrincipal。 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { openPaymentContract } from '@zenith/shared/payment';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  requireOpenScope,
  requireOpenSignatureChannel,
  type OpenPrincipal,
} from '../../middleware/open-gateway';
import { getClientIp } from '../../lib/request-helpers';
import {
  createOpenPaymentIntent,
  createOpenPaymentRefund,
  getOpenPaymentCapabilities,
  getOpenPaymentIntent,
  getOpenPaymentRefund,
} from '../../services/payment/payment-open.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 各端点所需 scope；同时供端点目录展示 */
const OPEN_PAYMENT_SCOPES = {
  createIntent: 'payment:intent:create',
  intentDetail: 'payment:intent:read',
  createRefund: 'payment:refund:create',
  refundDetail: 'payment:refund:read',
  capabilities: 'payment:intent:read',
} as const satisfies Record<Exclude<keyof typeof openPaymentContract, 'basePath'>, string>;

function principalOf(c: Context): OpenPrincipal {
  const principal = c.get('openPrincipal');
  if (!principal) throw new HTTPException(401, { message: '缺少有效的开放应用身份' });
  return principal;
}

const createIntentRoute = defineContractRoute(openPaymentContract.createIntent, {
  middleware: [
    requireOpenSignatureChannel,
    requireOpenScope(OPEN_PAYMENT_SCOPES.createIntent),
    idempotencyGuard({ ttlSeconds: 300, autoFingerprint: false }),
  ],
  handler: async (c) => c.json(okBody(await createOpenPaymentIntent({
    principal: principalOf(c),
    data: c.req.valid('json'),
    idempotencyKey: c.req.valid('header')['x-idempotency-key'],
    clientIp: getClientIp(c),
  }), '支付意图已创建'), 200),
});

const getIntentRoute = defineContractRoute(openPaymentContract.intentDetail, {
  middleware: [requireOpenScope(OPEN_PAYMENT_SCOPES.intentDetail)],
  handler: async (c) => c.json(okBody(await getOpenPaymentIntent(
    principalOf(c),
    c.req.valid('param').orderNo,
  )), 200),
});

const createRefundRoute = defineContractRoute(openPaymentContract.createRefund, {
  middleware: [
    requireOpenSignatureChannel,
    requireOpenScope(OPEN_PAYMENT_SCOPES.createRefund),
    idempotencyGuard({ ttlSeconds: 300, autoFingerprint: false }),
  ],
  handler: async (c) => c.json(okBody(await createOpenPaymentRefund({
    principal: principalOf(c),
    data: c.req.valid('json'),
    idempotencyKey: c.req.valid('header')['x-idempotency-key'],
  }), '退款已受理'), 200),
});

const getRefundRoute = defineContractRoute(openPaymentContract.refundDetail, {
  middleware: [requireOpenScope(OPEN_PAYMENT_SCOPES.refundDetail)],
  handler: async (c) => c.json(okBody(await getOpenPaymentRefund(
    principalOf(c),
    c.req.valid('param').refundNo,
  )), 200),
});

const capabilitiesRoute = defineContractRoute(openPaymentContract.capabilities, {
  middleware: [requireOpenScope(OPEN_PAYMENT_SCOPES.capabilities)],
  handler: async (c) => c.json(okBody(await getOpenPaymentCapabilities(principalOf(c))), 200),
});

router.openapiRoutes([
  createIntentRoute,
  getIntentRoute,
  createRefundRoute,
  getRefundRoute,
  capabilitiesRoute,
] as const);

/** 供 API 调试台展示的端点目录，由契约派生 */
export const OPEN_PAYMENT_ENDPOINTS: Array<{ method: string; path: string; summary: string; scope: string | null }> =
  (Object.keys(OPEN_PAYMENT_SCOPES) as Array<keyof typeof OPEN_PAYMENT_SCOPES>).map((name) => {
    const operation = openPaymentContract[name];
    return { method: operation.method.toUpperCase(), path: operation.fullPath, summary: operation.summary, scope: OPEN_PAYMENT_SCOPES[name] };
  });

export default router;
