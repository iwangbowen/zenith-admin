import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowEventSubscriptionContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listSubscriptions,
  getSubscription,
  getSubscriptionSecret,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  toggleSubscription,
  getSubscriptionBeforeAudit,
  listDeliveries,
  getDelivery,
  retryDelivery,
  retryDeliveries,
  replayDeliveriesByFilter,
  getDeliveryBeforeAudit,
  getDeliveriesBeforeAudit,
  testSubscriptionDelivery,
} from '../../services/workflow/workflow-event-subscriptions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'workflow:event-subscription:view' })] as const;
const deliveryView = [authMiddleware, guard({ permission: 'workflow:event-delivery:view' })] as const;

const list = defineContractRoute(workflowEventSubscriptionContract.list, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listSubscriptions(c.req.valid('query'))), 200),
});

const get = defineContractRoute(workflowEventSubscriptionContract.detail, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getSubscription(c.req.valid('param').id)), 200),
});

const getSecret = defineContractRoute(workflowEventSubscriptionContract.secret, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:view', audit: { description: '查看事件订阅 secret', module: '工作流管理', recordResponseBody: false } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditAfterData(c, { id, secretViewed: true });
    return c.json(okBody(await getSubscriptionSecret(id)), 200);
  },
});

const create = defineContractRoute(workflowEventSubscriptionContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:create', audit: { description: '创建事件订阅', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createSubscription(c.req.valid('json')), '已创建'), 200),
});

const update = defineContractRoute(workflowEventSubscriptionContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:edit', audit: { description: '更新事件订阅', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSubscriptionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateSubscription(id, c.req.valid('json')), '已更新'), 200);
  },
});

const remove = defineContractRoute(workflowEventSubscriptionContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:delete', audit: { description: '删除事件订阅', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSubscriptionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteSubscription(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const toggle = defineContractRoute(workflowEventSubscriptionContract.toggle, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:edit', audit: { description: '切换事件订阅启用状态', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSubscriptionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await toggleSubscription(id, c.req.valid('json').enabled), '已切换'), 200);
  },
});

const testDeliveryRoute = defineContractRoute(workflowEventSubscriptionContract.test, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-subscription:edit', audit: { description: '测试事件订阅投递', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const result = await testSubscriptionDelivery(id);
    return c.json(okBody(result, result.ok ? '测试投递成功' : '测试投递失败'), 200);
  },
});

// ─── 投递记录 ──────────────────────────────────────────────────────────────

const listDeliveriesRoute = defineContractRoute(workflowEventSubscriptionContract.deliveries, {
  middleware: deliveryView,
  handler: async (c) => c.json(okBody(await listDeliveries(c.req.valid('query'))), 200),
});

const getDeliveryRoute = defineContractRoute(workflowEventSubscriptionContract.deliveryDetail, {
  middleware: deliveryView,
  handler: async (c) => c.json(okBody(await getDelivery(c.req.valid('param').id)), 200),
});

const retryDeliveryRoute = defineContractRoute(workflowEventSubscriptionContract.retryDelivery, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-delivery:retry', audit: { description: '重试事件投递', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDeliveryBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await retryDelivery(id), '已加入重试队列'), 200);
  },
});

const batchRetryRoute = defineContractRoute(workflowEventSubscriptionContract.batchRetryDeliveries, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-delivery:retry', audit: { description: '批量重试事件投递', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getDeliveriesBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await retryDeliveries(ids);
    const after = await getDeliveriesBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
    return c.json(okBody({ count }, '已加入重试队列'), 200);
  },
});

const replayDeliveriesRoute = defineContractRoute(workflowEventSubscriptionContract.replayDeliveries, {
  middleware: [authMiddleware, guard({ permission: 'workflow:event-delivery:retry', audit: { description: '按筛选批量重放事件投递', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const result = await replayDeliveriesByFilter(c.req.valid('json'));
    return c.json(okBody(result, `已重放 ${result.count} 条投递`), 200);
  },
});

router.openapiRoutes([
  list, get, getSecret, create, update, remove, toggle, testDeliveryRoute,
  listDeliveriesRoute, getDeliveryRoute, retryDeliveryRoute, batchRetryRoute, replayDeliveriesRoute,
] as const);

export default router;
