import { OpenAPIHono } from '@hono/zod-openapi';
import { reportSubscriptionContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listSubscriptions, createSubscription, updateSubscription, deleteSubscription,
  ensureSubscriptionExists, mapSubscription, batchSetSubscriptionEnabled,
} from '../../services/report/report-subscription.service';
import { submitSubscriptionDeliveryTask } from '../../services/report/report-delivery-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(reportSubscriptionContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:subscription:list' })],
  handler: async (c) => c.json(okBody(await listSubscriptions(c.req.valid('query'))), 200),
});

const createRoute_ = defineContractRoute(reportSubscriptionContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:subscription:create', audit: { description: '创建报表订阅', module: '报表订阅' } })],
  handler: async (c) => c.json(okBody(await createSubscription(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportSubscriptionContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:subscription:update', audit: { description: '更新报表订阅', module: '报表订阅' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapSubscription(await ensureSubscriptionExists(id)));
    return c.json(okBody(await updateSubscription(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(reportSubscriptionContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:subscription:delete', audit: { description: '删除报表订阅', module: '报表订阅' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapSubscription(await ensureSubscriptionExists(id)));
    await deleteSubscription(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchStatusRoute = defineContractRoute(reportSubscriptionContract.batchStatus, {
  middleware: [authMiddleware, guard({ permission: 'report:subscription:update', audit: { description: '批量更新报表订阅状态', module: '报表订阅' } })],
  handler: async (c) => {
    const { ids, enabled } = c.req.valid('json');
    const count = await batchSetSubscriptionEnabled(ids, enabled);
    return c.json(okBody(null, `已更新 ${count} 条订阅状态`), 200);
  },
});

const runRoute = defineContractRoute(reportSubscriptionContract.run, {
  middleware: [authMiddleware, guard({ permission: 'report:subscription:update', audit: { description: '手动推送报表订阅', module: '报表订阅' } })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await submitSubscriptionDeliveryTask(c.req.valid('param').id), '任务已提交，可在任务中心查看进度'), 200),
});

router.openapiRoutes([listRoute, batchStatusRoute, createRoute_, updateRoute_, deleteRoute_, runRoute] as const);

export default router;
