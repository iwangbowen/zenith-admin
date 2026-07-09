import { and, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { config } from '../../config';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { getCreateTenantId, getEffectiveTenantId, isPlatformAdmin, tenantCondition } from '../../lib/tenant';

type TenantScopedTable = { tenantId: unknown };

export function reportTenantScope<T extends TenantScopedTable>(table: T): SQL | undefined {
  const user = currentUserOrNull();
  return user ? tenantCondition(table, user) : undefined;
}

export function reportScopedWhere<T extends TenantScopedTable>(table: T, condition: SQL): SQL {
  const scope = reportTenantScope(table);
  return scope ? and(condition, scope)! : condition;
}

export function reportCreateTenantId(): number | null {
  return getCreateTenantId(currentUser());
}

export function ensureInternalReportDatabaseAccess(): void {
  const user = currentUser();
  if (config.multiTenantMode && (!isPlatformAdmin(user) || getEffectiveTenantId(user) !== null)) {
    throw new HTTPException(403, { message: '多租户模式下仅平台视角的超级管理员可使用内置主库报表数据源' });
  }
}
