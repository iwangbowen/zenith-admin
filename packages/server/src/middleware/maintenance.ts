import { createMiddleware } from 'hono/factory';
import { authenticateAdminRequest } from './auth';
import { getMaintenanceStatus } from '../services/ops/maintenance.service';
import { maintenanceAccess } from '../lib/maintenance-access';
import { maintenanceException, maintenanceDecision } from '../services/ops/maintenance-access-policy';
import { authenticateAdminWs } from '../lib/ws-auth';
import { parseDateTimeInput } from '../lib/datetime';

export const maintenanceMiddleware = createMiddleware(async (c, next) => {
  if (maintenanceException(c.req.method, c.req.path)) return next();
  let status;
  try { status = await getMaintenanceStatus(); }
  catch {
    c.header('X-Zenith-Error', 'maintenance-unavailable');
    c.header('Cache-Control', 'no-store');
    return c.json({ code: 503, message: '维护状态暂不可用，请稍后重试', data: null }, 503);
  }
  if (!status.enabled) return next();
  let allowed = false;
  try {
    const user = c.req.header('upgrade')?.toLowerCase() === 'websocket' ? (await authenticateAdminWs(c))?.payload : await authenticateAdminRequest(c);
    if (user) allowed = maintenanceDecision(true, c.req.method, c.req.path, await maintenanceAccess(user)).allowed;
  } catch { /* An invalid identity never grants maintenance passage. */ }
  if (allowed) return next();
  c.header('X-Zenith-Error', 'maintenance');
  c.header('Cache-Control', 'no-store');
  c.header('Retry-After', String(status.estimatedEndAt ? Math.max(30, Math.ceil((parseDateTimeInput(status.estimatedEndAt)!.getTime() - Date.now()) / 1000)) : 60));
  return c.json({ code: 503, message: status.message, data: { enabled: true, version: status.version, estimatedEndAt: status.estimatedEndAt, startedAt: status.startedAt } }, 503);
});
