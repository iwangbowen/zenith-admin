import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isSuperAdmin, getUserPermissions } from './permissions';

/**
 * 远端主机准入校验。
 *
 * 领域功能权限（process:view / service:view 等）由 route guard 负责；
 * host:use 是第二道、仅在 hostId 非空时生效的远端主机准入权限。
 * 本机操作不要求 host:use，保持功能权限本身的既有语义。
 */
export async function assertRemoteHostAccess(c: Context, hostId?: number | null): Promise<void> {
  if (hostId == null) return;
  const user = c.get('user');
  if (user.tenantId != null) {
    throw new HTTPException(403, { message: '远程运维主机仅平台侧可用' });
  }
  if (isSuperAdmin(user)) return;
  const permissions = await getUserPermissions(user.userId);
  if (!permissions.includes('system:host:use')) {
    throw new HTTPException(403, { message: '无远程主机操作权限（system:host:use）' });
  }
}

/** 主机注册表自身的查询 / 管理同样只允许平台侧账号。 */
export function assertPlatformHostAccess(c: Context): void {
  const user = c.get('user');
  if (user.tenantId != null) {
    throw new HTTPException(403, { message: '运维主机仅平台侧可见' });
  }
}
