import { OpenAPIHono } from '@hono/zod-openapi';
import { maintenanceContract } from '@zenith/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { currentUser } from '../../lib/context';
import { maintenanceAccess } from '../../lib/maintenance-access';
import { getMaintenanceDetail, getPublicMaintenanceStatus, updateMaintenanceStatus, listMaintenanceLogs, getMaintenanceLog, planMaintenance, maintenanceAction, diagnoseMaintenance, listMaintenanceRecipients } from '../../services/ops/maintenance.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([
  defineContractRoute(maintenanceContract.status, { handler: async (c) => { c.header('Cache-Control', 'no-store'); return c.json(okBody(await getPublicMaintenanceStatus()), 200); } }),
  defineContractRoute(maintenanceContract.access, { handler: async (c) => c.json(okBody(await maintenanceAccess(currentUser())), 200) }),
  defineContractRoute(maintenanceContract.detail, { handler: async (c) => c.json(okBody(await getMaintenanceDetail()), 200) }),
  defineContractRoute(maintenanceContract.recipients, { handler: async (c) => c.json(okBody(await listMaintenanceRecipients()), 200) }),
  defineContractRoute(maintenanceContract.update, { handler: async (c) => c.json(okBody(await updateMaintenanceStatus(c.req.valid('json'))), 200) }),
  defineContractRoute(maintenanceContract.plan, { handler: async (c) => c.json(okBody(await planMaintenance(c.req.valid('json'))), 200) }),
  defineContractRoute(maintenanceContract.start, { handler: async (c) => c.json(okBody(await maintenanceAction('start', c.req.valid('json'))), 200) }),
  defineContractRoute(maintenanceContract.cancel, { handler: async (c) => c.json(okBody(await maintenanceAction('cancel', c.req.valid('json'))), 200) }),
  defineContractRoute(maintenanceContract.logs, { handler: async (c) => c.json(okBody(await listMaintenanceLogs(c.req.valid('query'))), 200) }),
  defineContractRoute(maintenanceContract.log, { handler: async (c) => c.json(okBody(await getMaintenanceLog(c.req.valid('param').id)), 200) }),
  defineContractRoute(maintenanceContract.diagnose, { handler: async (c) => c.json(okBody(await diagnoseMaintenance(c.req.valid('json'))), 200) }),
]);
export default router;
