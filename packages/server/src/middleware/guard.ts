import type { Context, MiddlewareHandler, Next } from 'hono';
import type { JwtPayload } from './auth';
import type { AuditLogOptions } from './audit';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { auditLog } from './audit';

export interface GuardOptions {
  /** 需要的权限码，传字符串或数组（满足其一即可） */
  permission?: string | string[];
  /** 审计日志配置；不传则不记录操作日志 */
  audit?: AuditLogOptions;
}

/**
 * 统一路由守卫中间件。
 * 按顺序执行：权限校验 → 审计日志（可选）→ next()
 */
export function guard(opts: GuardOptions): MiddlewareHandler {
  const auditMiddleware = opts.audit ? auditLog(opts.audit) : null;

  return async (c: Context, next: Next) => {
    // ── 权限校验 ──
    if (opts.permission) {
      const user = c.get('user') as JwtPayload;
      if (!isSuperAdmin(user.roles)) {
        const perms = Array.isArray(opts.permission)
          ? opts.permission
          : [opts.permission];
        const userPerms = await getUserPermissions(user.userId);
        const hasPermission = perms.some((p) => userPerms.includes(p));
        if (!hasPermission) {
          return c.json({ code: 403, message: '权限不足', data: null }, 403);
        }
      }
    }

    // ── 审计日志 ──
    if (auditMiddleware) {
      return auditMiddleware(c, next);
    }

    await next();
  };
}
