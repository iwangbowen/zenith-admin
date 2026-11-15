import { OpenAPIHono } from '@hono/zod-openapi';
import { maintenanceContract } from '@zenith/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { currentUser } from '../../lib/context';
import { maintenanceAccess } from '../../lib/maintenance-access';
import { getMaintenanceStatus, getPublicMaintenanceStatus, updateMaintenanceStatus, listMaintenanceLogs, getMaintenanceLog, planMaintenance, maintenanceAction } from '../../services/ops/maintenance.service';
import { MAINTENANCE_EXCEPTIONS, MAINTENANCE_BOUNDARIES, maintenanceException } from '../../services/ops/maintenance-access-policy';
import { HTTPException } from 'hono/http-exception';

const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([
  defineContractRoute(maintenanceContract.status, { handler: async (c) => { c.header('Cache-Control', 'no-store'); return c.json(okBody(await getPublicMaintenanceStatus()), 200); } }),
  defineContractRoute(maintenanceContract.access, { handler: async (c) => c.json(okBody(await maintenanceAccess(currentUser())), 200) }),
  defineContractRoute(maintenanceContract.detail, { handler: async (c) => c.json(okBody(await getMaintenanceStatus()), 200) }),
  defineContractRoute(maintenanceContract.update, { handler: async (c) => c.json(okBody(await updateMaintenanceStatus(c.req.valid('json'))), 200) }),
  defineContractRoute(maintenanceContract.plan, { handler: async (c) => c.json(okBody(await planMaintenance(c.req.valid('json'))), 200) }),
  defineContractRoute(maintenanceContract.start, { handler: async (c) => c.json(okBody(await maintenanceAction('start', c.req.valid('json'))), 200) }),
  defineContractRoute(maintenanceContract.cancel, { handler: async (c) => c.json(okBody(await maintenanceAction('cancel', c.req.valid('json'))), 200) }),
  defineContractRoute(maintenanceContract.logs, { handler: async (c) => c.json(okBody(await listMaintenanceLogs(c.req.valid('query'))), 200) }),
  defineContractRoute(maintenanceContract.log, { handler: async (c) => c.json(okBody(await getMaintenanceLog(c.req.valid('param').id)), 200) }),
  defineContractRoute(maintenanceContract.diagnose, { handler: async (c) => {
    const input = c.req.valid('json'); const status = await getMaintenanceStatus();
    if (input.version !== status.version) throw new HTTPException(409, { message: '维护状态已变化，请重新诊断' });
    const access = await maintenanceAccess(currentUser()); const exception = maintenanceException(input.method, input.path);
    const allowed = !status.enabled || !!exception || access.canBypass || (input.path.startsWith('/api/maintenance/') && access.canView);
    return c.json(okBody({ allowed, reason: !status.enabled ? '未处于维护中' : exception?.reason ?? (access.canBypass ? '主体具有维护业务通行权限，业务权限仍需验证' : allowed ? '维护管理恢复通路' : '维护策略拒绝'), version: status.version, exceptions: [...MAINTENANCE_EXCEPTIONS], boundaries: MAINTENANCE_BOUNDARIES }), 200);
  } }),
]);
export default router;
