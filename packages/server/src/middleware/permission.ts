import type { Context, Next } from 'hono';
import type { JwtPayload } from './auth';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';

export function requirePermission(...requiredPerms: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as JwtPayload;

    // super_admin bypasses all permission checks
    if (isSuperAdmin(user.roles)) {
      await next();
      return;
    }

    const userPerms = await getUserPermissions(user.userId);
    const hasPermission = requiredPerms.some((p) => userPerms.includes(p));

    if (!hasPermission) {
      return c.json({ code: 403, message: '权限不足', data: null }, 403);
    }

    await next();
  };
}
