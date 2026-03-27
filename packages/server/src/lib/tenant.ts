import type { SQL } from 'drizzle-orm';
import { eq, isNull } from 'drizzle-orm';
import { config } from '../config';
import type { JwtPayload } from '../middleware/auth';

const SUPER_ADMIN_CODE = 'super_admin';

/** Check if the current user is a platform super admin (tenantId is null) */
export function isPlatformAdmin(user: JwtPayload): boolean {
  return user.roles.includes(SUPER_ADMIN_CODE) && user.tenantId === null;
}

/** Get the effective tenant ID (viewingTenantId takes priority for super admin) */
export function getEffectiveTenantId(user: JwtPayload): number | null {
  if (!config.multiTenantMode) return null;
  if (isPlatformAdmin(user) && user.viewingTenantId !== undefined) {
    return user.viewingTenantId;
  }
  return user.tenantId;
}

/**
 * Build a tenant filter condition for queries.
 * - Multi-tenant off → no filter
 * - Platform admin without viewingTenantId → no filter (sees all)
 * - Platform admin with viewingTenantId → filter by that tenant
 * - Normal user → filter by their tenantId
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tenantCondition<T extends { tenantId: any }>(
  table: T,
  user: JwtPayload,
): SQL | undefined {
  if (!config.multiTenantMode) return undefined;

  const effectiveTenantId = getEffectiveTenantId(user);

  // Platform admin sees all when not viewing a specific tenant
  if (isPlatformAdmin(user) && effectiveTenantId === null) {
    return undefined;
  }

  // Filter by tenant
  if (effectiveTenantId === null) {
    return isNull(table.tenantId);
  }
  return eq(table.tenantId, effectiveTenantId);
}

/**
 * Get the tenant ID to assign when creating records.
 * Returns the effective tenant ID for the current user.
 */
export function getCreateTenantId(user: JwtPayload): number | null {
  if (!config.multiTenantMode) return null;
  return getEffectiveTenantId(user);
}
