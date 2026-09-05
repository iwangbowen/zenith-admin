/**
 * 支付链接公开端点（无需登录，供 C 端用户访问收款链接/收款码）。
 *
 * GET  /api/public/payment/link/{token}      展示链接信息
 * POST /api/public/payment/link/{token}/pay  创建收银台会话并下单
 * GET  /api/public/payment/link/{token}/sessions/{sessionToken} 恢复会话
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentLinkPublicContract } from '@zenith/shared/payment';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getPublicLink, payByLink } from '../../services/payment/payment-link.service';
import { getPublicCashierSession } from '../../services/payment/payment-cashier-session.service';
import { getClientIp } from '../../lib/request-helpers';
import { namedRateLimit } from '../../middleware/rate-limit';

const router = new OpenAPIHono({ defaultHook: validationHook });

const getRoute = defineContractRoute(paymentLinkPublicContract.detail, {
  middleware: [],
  handler: async (c) => c.json(okBody(await getPublicLink(c.req.valid('param').token)), 200),
});

const payRoute = defineContractRoute(paymentLinkPublicContract.pay, {
  middleware: [namedRateLimit('payment_public_link')],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await payByLink(token, { ...body, clientIp: getClientIp(c) }), '收银台会话已创建'), 200);
  },
});

const sessionRoute = defineContractRoute(paymentLinkPublicContract.session, {
  middleware: [namedRateLimit('payment_public_link')],
  handler: async (c) => {
    const { token, sessionToken } = c.req.valid('param');
    return c.json(okBody(await getPublicCashierSession(token, sessionToken)), 200);
  },
});

router.openapiRoutes([getRoute, payRoute, sessionRoute] as const);

export default router;
