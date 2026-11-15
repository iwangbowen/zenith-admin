import { createMiddleware } from 'hono/factory';
import { authenticateAdminRequest } from './auth';
import { getMaintenanceStatus } from '../services/ops/maintenance.service';
import { maintenanceAccess } from '../lib/maintenance-access';
import { maintenanceException } from '../services/ops/maintenance-access-policy';
import { parseDateTimeInput } from '../lib/datetime';

export const maintenanceMiddleware = createMiddleware(async (c, next) => {
  if (maintenanceException(c.req.method, c.req.path)) return next();
  let status;
  try { status = await getMaintenanceStatus(); }
  catch {
    c.header('X-Zenith-Error', 'maintenance-unavailable');
    return c.json({ code: 503, message: '维护状态暂不可用，请稍后重试', data: null }, 503);
  }
  if (!status.enabled) return next();
  try {
    const user = await authenticateAdminRequest(c);
    const access = await maintenanceAccess(user);
    const managementPath = /^\/api\/maintenance(?:\/|$)/.test(c.req.path);
    const shellPath = c.req.method === 'GET' && ['/api/menus/user', '/api/settings/me', '/api/auth/me'].includes(c.req.path);
    if (access.canBypass || ((managementPath || shellPath) && (access.canView || access.canManage || access.canViewLogs))) return next();
  } catch { /* An invalid identity never grants maintenance passage. */ }
  c.header('X-Zenith-Error', 'maintenance');
  c.header('Cache-Control', 'no-store');
  c.header('Retry-After', String(status.estimatedEndAt ? Math.max(30, Math.ceil((parseDateTimeInput(status.estimatedEndAt)!.getTime() - Date.now()) / 1000)) : 60));
  return c.json({ code: 503, message: status.message, data: { enabled: true, version: status.version, estimatedEndAt: status.estimatedEndAt, startedAt: status.startedAt } }, 503);
});
