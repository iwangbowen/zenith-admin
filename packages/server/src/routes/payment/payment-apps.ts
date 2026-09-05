/**
 * 支付应用（App 维度）管理路由。
 * 外部身份由开放平台客户端管理，本模块只维护支付渠道路由。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentAppContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listApps, getApp, createApp, updateApp, deleteApp } from '../../services/payment/payment-apps.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentAppContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:app:list' })],
  handler: async (c) => c.json(okBody(await listApps(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(paymentAppContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:app:list' })],
  handler: async (c) => c.json(okBody(await getApp(c.req.valid('param').id)), 200),
});

const createAppRoute = defineContractRoute(paymentAppContract.create, {
  middleware: [authMiddleware, guard({ permission: 'payment:app:manage', audit: { description: '新增支付应用', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await createApp(c.req.valid('json')), '创建成功'), 200),
});

const updateAppRoute = defineContractRoute(paymentAppContract.update, {
  middleware: [authMiddleware, guard({ permission: 'payment:app:manage', audit: { description: '编辑支付应用', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getApp(id));
    return c.json(okBody(await updateApp(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteAppRoute = defineContractRoute(paymentAppContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'payment:app:manage', audit: { description: '删除支付应用', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getApp(id));
    await deleteApp(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, detailRoute, createAppRoute, updateAppRoute, deleteAppRoute] as const);

export default router;
