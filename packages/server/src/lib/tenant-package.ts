import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { tenants, tenantPackages, tenantPackageMenus, menus } from '../db/schema';
import { config } from '../config';

/**
 * 返回指定租户「套餐菜单白名单」的 Set。
 *
 * 返回 `null` 表示**不限制**（调用方应放行全部菜单），命中以下任一条件即视为不限制：
 *  - 多租户模式关闭（`MULTI_TENANT_MODE=false`，默认）
 *  - `tenantId` 为空（平台级 / 平台超管未切换租户视角）
 *  - 该租户未绑定套餐（`packageId` 为空）
 *
 * 仅当多租户开启、且租户绑定了套餐时，才返回该套餐关联的菜单 ID 集合：
 *  - 套餐被**禁用**时返回空集（fail-closed：除「不可见的内置工具菜单」外功能全关）
 *  - 白名单中菜单的 **button 子节点自动并入**（按钮权限随页面开放；套餐管理只需圈选到
 *    页面粒度，避免只勾页面导致角色无法分配按钮权限的功能死锁）
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

  const [pkg] = await db
    .select({ status: tenantPackages.status })
    .from(tenantPackages)
    .where(eq(tenantPackages.id, tenant.packageId))
    .limit(1);
  if (!pkg) return null;
  if (pkg.status === 'disabled') return new Set();

  const rows = await db
    .select({ menuId: tenantPackageMenus.menuId })
    .from(tenantPackageMenus)
    .where(eq(tenantPackageMenus.packageId, tenant.packageId));
  const ids = new Set(rows.map((r) => r.menuId));

  if (ids.size > 0) {
    const buttons = await db
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.type, 'button'), inArray(menus.parentId, [...ids])));
    for (const b of buttons) ids.add(b.id);
  }
  return ids;
}
