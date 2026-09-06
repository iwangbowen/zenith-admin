import { eq, and, isNull } from 'drizzle-orm';
import { SUPER_ADMIN_CODE } from '@zenith/shared/identity';
import { db } from '../../db';
import { roles, userRoles, users } from '../../db/schema';

export interface EnabledPlatformSuperAdmin {
  id: number;
}

/** 平台超管（tenantId 为空且绑定 super_admin 角色）的启用用户 */
export async function listEnabledPlatformSuperAdmins(): Promise<EnabledPlatformSuperAdmin[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.code, SUPER_ADMIN_CODE), isNull(users.tenantId), eq(users.status, 'enabled')));
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}
