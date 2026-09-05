/**
 * 通知策略路由（管理员）：事件目录 / 作用域覆盖 / 派发日志。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { notificationPolicyContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { currentUser } from '../../lib/context';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listNotificationDispatches,
  listNotificationPolicyEvents,
  resetNotificationOverride,
  saveNotificationOverride,
  testFireNotificationEvent,
} from '../../services/messaging/notification-policies.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:notify-policy:list' })] as const;

const eventsRoute = defineContractRoute(notificationPolicyContract.events, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listNotificationPolicyEvents()), 200),
});

const saveOverrideRoute = defineContractRoute(notificationPolicyContract.saveOverride, {
  middleware: [authMiddleware, guard({
    permission: 'system:notify-policy:save',
    audit: { description: '保存通知策略覆盖', module: '通知策略' },
  })],
  handler: async (c) => {
    await saveNotificationOverride(c.req.valid('json'));
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const resetOverrideRoute = defineContractRoute(notificationPolicyContract.resetOverride, {
  middleware: [authMiddleware, guard({
    permission: 'system:notify-policy:save',
    audit: { description: '重置通知策略覆盖', module: '通知策略' },
  })],
  handler: async (c) => {
    await resetNotificationOverride(c.req.valid('json'));
    return c.json(okBody(null, '已恢复默认'), 200);
  },
});

const testFireRoute = defineContractRoute(notificationPolicyContract.testFire, {
  middleware: [authMiddleware, guard({
    permission: 'system:notify-policy:test',
    audit: { description: '测试触发通知事件', module: '通知策略' },
  })],
  handler: async (c) => {
    const { eventKey } = c.req.valid('json');
    const outboxId = await testFireNotificationEvent(eventKey, currentUser().userId);
    return c.json(okBody({ outboxId }, '已触发,请在「投递日志」查看派发结果'), 200);
  },
});

const dispatchesRoute = defineContractRoute(notificationPolicyContract.dispatches, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listNotificationDispatches(c.req.valid('query'))), 200),
});

router.openapiRoutes([
  eventsRoute,
  saveOverrideRoute,
  resetOverrideRoute,
  testFireRoute,
  dispatchesRoute,
] as const);

export default router;
