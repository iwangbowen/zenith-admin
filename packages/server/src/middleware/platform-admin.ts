import { createMiddleware } from 'hono/factory';
import { errBody } from '../lib/openapi-schemas';
import { isPlatformAdmin } from '../lib/tenant';
import { config } from '../config';
import type { AppEnv } from '../lib/context';

/**
 * 平台管理员守卫（须挂在 authMiddleware 之后）。
 *
 * - 默认（onlyInMultiTenant=false）：始终要求平台超管（roles 含 super_admin 且 tenantId=null），
 *   适用于租户 / 租户套餐等纯多租户管理资源。
 * - onlyInMultiTenant=true：仅在多租户模式开启时强制，单租户部署放行——
 *   适用于菜单 / 地区 / 数据脱敏等全局共享资源：多租户下修改会影响所有租户（须平台身份），
 *   单租户下由普通权限码控制即可，避免破坏非超管管理员的正常管理。
 */
export function platformAdminOnly(options?: { message?: string; onlyInMultiTenant?: boolean }) {
  const { message = '仅平台管理员可执行此操作', onlyInMultiTenant = false } = options ?? {};
  return createMiddleware<AppEnv>(async (c, next) => {
    if (onlyInMultiTenant && !config.multiTenantMode) {
      await next();
      return;
    }
    const user = c.get('user');
    if (!isPlatformAdmin(user)) {
      return c.json(errBody(message, 403), 403);
    }
    await next();
  });
}
