import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowEventSubscriptionContract } from '@zenith/shared/workflow';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
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
  replayDelivery,
  retryDeliveries,
  replayDeliveriesByFilter,
  getDeliveryBeforeAudit,
  getDeliveriesBeforeAudit,
  testSubscriptionDelivery,
} from '../../services/workflow/workflow-event-subscriptions.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const getSecret = defineContractRoute(workflowEventSubscriptionContract.secret, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditAfterData(c, { id, secretViewed: true });
    return c.json(okBody(await getSubscriptionSecret(id)), 200);
  },
});
const toggle = defineContractRoute(workflowEventSubscriptionContract.toggle, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSubscriptionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await toggleSubscription(id, c.req.valid('json').enabled), '已切换'), 200);
  },
});

const testDeliveryRoute = defineContractRoute(workflowEventSubscriptionContract.test, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const result = await testSubscriptionDelivery(id);
    return c.json(okBody(result, result.ok ? '测试投递成功' : '测试投递失败'), 200);
  },
});

// ─── 投递记录 ──────────────────────────────────────────────────────────────

const listDeliveriesRoute = defineContractRoute(workflowEventSubscriptionContract.deliveries, {
  handler: async (c) => c.json(okBody(await listDeliveries(c.req.valid('query'))), 200),
});

const getDeliveryRoute = defineContractRoute(workflowEventSubscriptionContract.deliveryDetail, {
  handler: async (c) => c.json(okBody(await getDelivery(c.req.valid('param').id)), 200),
});

const retryDeliveryRoute = defineContractRoute(workflowEventSubscriptionContract.retryDelivery, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDeliveryBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await retryDelivery(id), '已加入重试队列'), 200);
  },
});

const replayDeliveryRoute = defineContractRoute(workflowEventSubscriptionContract.replayDelivery, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDeliveryBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await replayDelivery(id), '已加入投递队列'), 200);
  },
});

const batchRetryRoute = defineContractRoute(workflowEventSubscriptionContract.batchRetryDeliveries, {
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
  handler: async (c) => {
    const result = await replayDeliveriesByFilter(c.req.valid('json'));
    return c.json(okBody(result, `已重放 ${result.count} 条投递`), 200);
  },
});

mountCrud(router, workflowEventSubscriptionContract,
  {
    list: listSubscriptions,
    get: getSubscription,
    create: createSubscription,
    update: updateSubscription,
    remove: deleteSubscription,
  },
  {
    messages: { create: '已创建', update: '已更新', remove: '已删除' },
  },
  [
    getSecret,
    toggle,
    testDeliveryRoute,
    listDeliveriesRoute,
    getDeliveryRoute,
    retryDeliveryRoute,
    replayDeliveryRoute,
    batchRetryRoute,
    replayDeliveriesRoute,
  ],
);

export default router;
