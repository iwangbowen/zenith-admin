import { OpenAPIHono } from '@hono/zod-openapi';
import { licensingContract } from '@zenith/shared/licensing';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { platformAdminOnly } from '../../middleware/platform-admin';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getLicensingStatus,
  activateLicense,
  deactivateLicense,
  listLicenseEvents,
} from '../../services/platform/licensing.service';

const licensingRoute = new OpenAPIHono({ defaultHook: validationHook });

const platformAdminMiddleware = platformAdminOnly({ message: '仅平台管理员可管理 License 授权' });

const view = [authMiddleware, platformAdminMiddleware, guard({ permission: 'system:license:view' })] as const;

const statusRoute = defineContractRoute(licensingContract.status, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getLicensingStatus()), 200),
});

const activateRoute = defineContractRoute(licensingContract.activate, {
  middleware: [
    authMiddleware,
    platformAdminMiddleware,
    guard({ permission: 'system:license:manage', audit: { module: 'License 授权', description: '激活 License', recordBody: false } }),
  ],
  handler: async (c) => {
    const { envelope } = c.req.valid('json');
    const user = c.get('user');
    return c.json(okBody(await activateLicense(envelope, user?.userId ?? null), '激活成功'), 200);
  },
});

const deactivateRoute = defineContractRoute(licensingContract.deactivate, {
  middleware: [
    authMiddleware,
    platformAdminMiddleware,
    guard({ permission: 'system:license:manage', audit: { module: 'License 授权', description: '停用 License' } }),
  ],
  handler: async (c) => {
    await deactivateLicense();
    return c.json(okBody(null, '已停用'), 200);
  },
});

const eventsRoute = defineContractRoute(licensingContract.events, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listLicenseEvents(c.req.valid('query'))), 200),
});

licensingRoute.openapiRoutes([statusRoute, activateRoute, deactivateRoute, eventsRoute] as const);

export default licensingRoute;
