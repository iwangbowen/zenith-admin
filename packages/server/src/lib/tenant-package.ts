import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tenants, tenantPackageMenus } from '../db/schema';
import { config } from '../config';

/**
 * 返回指定租户「套餐菜单白名单」的 Set。
 *
 * 返回 `null` 表示**不限制**（调用方应放行全部菜单），命中以下任一条件即视为不限制：
 *  - 多租户模式关闭（`MULTI_TENANT_MODE=false`，默认）
 *  - `tenantId` 为空（平台级 / 平台超管未切换租户视角）
 *  - 该租户未绑定套餐（`packageId` 为空）
 *
 * 仅当多租户开启、且租户绑定了套餐时，才返回该套餐关联的菜单 ID 集合（可能为空集，
 * 表示该租户除「不可见的内置工具菜单」外不开放任何功能菜单）。
 */
export async function getTenantPackageMenuIdSet(tenantId: number | null | undefined): Promise<Set<number> | null> {
  if (!config.multiTenantMode) return null;
  if (tenantId == null) return null;

  const [tenant] = await db
    .select({ packageId: tenants.packageId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant || tenant.packageId == null) return null;

  const rows = await db
    .select({ menuId: tenantPackageMenus.menuId })
    .from(tenantPackageMenus)
    .where(eq(tenantPackageMenus.packageId, tenant.packageId));
  return new Set(rows.map((r) => r.menuId));
}
