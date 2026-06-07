import { createMiddleware } from 'hono/factory';
import { verifyToken } from '../lib/jwt';
import type { JwtPayload } from './auth';
import { getMaintenanceStatus } from '../services/maintenance.service';
import { SUPER_ADMIN_CODE } from '@zenith/shared';

/** Paths exempt from maintenance mode blocking */
const BYPASS_PREFIXES = [
  '/api/health',
  '/api/auth/',
  '/api/maintenance/status',
  '/metrics',
  '/api/ws',
];

export const maintenanceMiddleware = createMiddleware(async (c, next) => {
  const path = c.req.path;

  // Always pass through bypass paths
  if (BYPASS_PREFIXES.some((p) => path === p || path.startsWith(p))) {
    return next();
  }

  const status = await getMaintenanceStatus();
  if (!status.enabled) return next();

  // Super admin bypasses maintenance
  const authorization = c.req.header('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    try {
      const payload = await verifyToken<JwtPayload>(authorization.slice(7));
      if (payload.roles?.includes(SUPER_ADMIN_CODE)) return next();
    } catch {
      // invalid token — fall through to maintenance block
    }
  }

  return c.json(
    { code: 503, message: status.message || '系统维护中，请稍后重试', data: null },
    503,
  );
});
