/**
 * 通知策略路由（管理员）：事件目录 / 作用域覆盖 / 派发日志。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { notificationPolicyContract } from '@zenith/shared/messaging';
import { currentUser } from '../../lib/context';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listNotificationDispatches,
  getNotificationOutbox,
  listNotificationPolicyEvents,
  resetNotificationOverride,
  saveNotificationOverride,
  testFireNotificationEvent,
} from '../../services/messaging/notification-policies.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const eventsRoute = defineContractRoute(notificationPolicyContract.events, {
  handler: async (c) => c.json(okBody(await listNotificationPolicyEvents()), 200),
});

const saveOverrideRoute = defineContractRoute(notificationPolicyContract.saveOverride, {
  handler: async (c) => {
    await saveNotificationOverride(c.req.valid('json'));
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const resetOverrideRoute = defineContractRoute(notificationPolicyContract.resetOverride, {
  handler: async (c) => {
    await resetNotificationOverride(c.req.valid('json'));
    return c.json(okBody(null, '已恢复默认'), 200);
  },
});

const testFireRoute = defineContractRoute(notificationPolicyContract.testFire, {
  handler: async (c) => {
    const { eventKey } = c.req.valid('json');
    const outboxId = await testFireNotificationEvent(eventKey, currentUser().userId);
    return c.json(okBody({ outboxId }, '已触发,请在「投递日志」查看派发结果'), 200);
  },
});

const dispatchesRoute = defineContractRoute(notificationPolicyContract.dispatches, {
  handler: async (c) => c.json(okBody(await listNotificationDispatches(c.req.valid('query'))), 200),
});
const outboxDetailRoute = defineContractRoute(notificationPolicyContract.outboxDetail, {
  handler: async (c) => c.json(okBody(await getNotificationOutbox(c.req.valid('param').id)), 200),
});

router.openapiRoutes([
  eventsRoute,
  saveOverrideRoute,
  resetOverrideRoute,
  testFireRoute,
  dispatchesRoute,
  outboxDetailRoute,
] as const);

export default router;
