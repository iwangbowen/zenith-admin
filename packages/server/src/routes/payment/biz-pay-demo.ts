import { OpenAPIHono } from '@hono/zod-openapi';
import { bizPayDemoContract } from '@zenith/shared/biz';
import { authMiddleware } from '../../middleware/auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getClientIp } from '../../lib/request-helpers';
import {
  listBizPayDemos, getBizPayDemo, createBizPayDemo, deleteBizPayDemo, payBizPayDemo, simulateBizPayDemoPaid,
} from '../../services/payment/biz-pay-demo.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(bizPayDemoContract.list, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listBizPayDemos(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(bizPayDemoContract.detail, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await getBizPayDemo(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(bizPayDemoContract.create, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await createBizPayDemo(c.req.valid('json')), '创建成功'), 200),
});

const deleteRoute = defineContractRoute(bizPayDemoContract.remove, {
  middleware: [authMiddleware],
  handler: async (c) => {
    await deleteBizPayDemo(c.req.valid('param').id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const payRoute = defineContractRoute(bizPayDemoContract.pay, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10, message: '下单处理中，请勿重复提交' })],
  handler: async (c) => c.json(okBody(await payBizPayDemo(c.req.valid('param').id, c.req.valid('json'), getClientIp(c)), '下单成功'), 200),
});

const simulateRoute = defineContractRoute(bizPayDemoContract.simulatePaid, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await simulateBizPayDemoPaid(c.req.valid('param').id), '已模拟支付成功'), 200),
});

router.openapiRoutes([listRoute, getRoute, createRouteDef, deleteRoute, payRoute, simulateRoute] as const);

export default router;
