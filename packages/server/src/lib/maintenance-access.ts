import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { config } from '../config';
import { getUserPermissions, runWithFreshUserPermissions } from './permissions';
import { enabledGroupRolesWith, extractEnabledGroupRoles } from './user-group-access';
import type { JwtPayload } from '../middleware/auth';

export async function maintenanceAccess(user: JwtPayload) {
  const subject = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, user.userId),
    columns: { tenantId: true, status: true }, with: {
      userRoles: { with: { role: { columns: { code: true, status: true, tenantId: true } } } },
      userGroupMembers: enabledGroupRolesWith({ columns: { code: true, status: true, tenantId: true } }),
    } });
  const none = { canView: false, canManage: false, canViewLogs: false, canBypass: false };
  if (!subject || subject.status !== 'enabled') return none;
  const superAdmin = subject.tenantId === null && [...subject.userRoles.map((r) => r.role), ...extractEnabledGroupRoles(subject.userGroupMembers).roles]
    .some((role) => role.code === 'super_admin' && role.status === 'enabled' && role.tenantId === null);
  if (config.multiTenantMode && !superAdmin) return none;
  if (superAdmin) return { canView: true, canManage: !user.impersonation, canViewLogs: true, canBypass: !user.impersonation };
  const permissions = await runWithFreshUserPermissions(user.userId, () => getUserPermissions(user.userId));
  const canManage = !user.impersonation && permissions.includes('system:maintenance:manage');
  return { canManage, canView: canManage || permissions.includes('system:maintenance:view'),
    canViewLogs: canManage || permissions.includes('system:maintenance:log'), canBypass: !user.impersonation && permissions.includes('system:maintenance:bypass') };
}
export async function assertMaintenanceManager(user: JwtPayload) {
  if (!(await maintenanceAccess(user)).canManage) throw new HTTPException(403, { message: '没有维护管理权限或平台身份不足' });
}
