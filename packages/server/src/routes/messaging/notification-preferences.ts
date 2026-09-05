/**
 * 个人通知偏好路由：矩阵、全局设置。
 * 全部为登录用户自助操作，不挂权限码（与「我的站内信」同规格）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { notificationPreferenceContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getMyNotificationMatrix,
  getMyNotificationSettings,
  saveMyNotificationPreferences,
  saveMyNotificationSettings,
} from '../../services/messaging/notification-preferences.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const matrixRoute = defineContractRoute(notificationPreferenceContract.matrix, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await getMyNotificationMatrix()), 200),
});

const saveMatrixRoute = defineContractRoute(notificationPreferenceContract.saveMatrix, {
  middleware: [authMiddleware],
  handler: async (c) => {
    await saveMyNotificationPreferences(c.req.valid('json'));
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const settingsRoute = defineContractRoute(notificationPreferenceContract.settings, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await getMyNotificationSettings()), 200),
});

const saveSettingsRoute = defineContractRoute(notificationPreferenceContract.saveSettings, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await saveMyNotificationSettings(c.req.valid('json')), '保存成功'), 200),
});

router.openapiRoutes([
  matrixRoute,
  saveMatrixRoute,
  settingsRoute,
  saveSettingsRoute,
] as const);

export default router;
