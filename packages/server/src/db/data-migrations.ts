import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { CMS_RAW_EXPORT_MENU_IDS, SEED_MENUS } from '@zenith/shared';
import type { Db, DbTransaction } from './types';
import {
  appDataMigrations,
  menus,
  roleMenus,
  roles,
  systemConfigs,
  tenantPackageMenus,
  userMenus,
} from './schema';
import { mapMenuSeedRows, upsertCmsMenuSeedRows } from './cms-menu-seed';

interface AppDataMigration {
  key: string;
  description: string;
  run(tx: DbTransaction): Promise<void>;
}

export async function applyCmsStage3MenuData(tx: DbTransaction): Promise<void> {
  const rows = mapMenuSeedRows(SEED_MENUS);
  await upsertCmsMenuSeedRows(tx, rows);
  const cmsMenuIds = rows.filter((row) => row.id >= 1700 && row.id < 1900).map((row) => row.id);
  const roleRows = await tx.select({ id: roles.id, code: roles.code }).from(roles)
    .where(inArray(roles.code, ['super_admin', 'cms_editor']));
  if (roleRows.length && cmsMenuIds.length) {
    await tx.insert(roleMenus)
      .values(roleRows.flatMap((role) => cmsMenuIds
        .filter((menuId) => role.code === 'super_admin'
          || !CMS_RAW_EXPORT_MENU_IDS.includes(menuId as (typeof CMS_RAW_EXPORT_MENU_IDS)[number]))
        .map((menuId) => ({ roleId: role.id, menuId }))))
      .onConflictDoNothing();
  }
}

export const CMS_STAGE4_MENU_REMAP = new Map<number, number>([
  [1751, 1792],
  [1752, 1793],
]);

export function remapCmsMenuBindingRows<T extends Record<string, number>>(
  rows: readonly T[],
  ownerKey: keyof T,
): Array<Record<string, number>> {
  return rows.flatMap((row) => {
    const menuId = CMS_STAGE4_MENU_REMAP.get(row.menuId);
    return menuId ? [{ [ownerKey]: row[ownerKey], menuId }] : [];
  });
}

export async function applyCmsStage4MenuData(tx: DbTransaction): Promise<void> {
  await applyCmsStage3MenuData(tx);
  const obsoleteMenuIds = [...CMS_STAGE4_MENU_REMAP.keys()];
  const [legacyRoles, legacyUsers, legacyPackages] = await Promise.all([
    tx.select({ roleId: roleMenus.roleId, menuId: roleMenus.menuId }).from(roleMenus)
      .where(inArray(roleMenus.menuId, obsoleteMenuIds)),
    tx.select({ userId: userMenus.userId, menuId: userMenus.menuId }).from(userMenus)
      .where(inArray(userMenus.menuId, obsoleteMenuIds)),
    tx.select({ packageId: tenantPackageMenus.packageId, menuId: tenantPackageMenus.menuId }).from(tenantPackageMenus)
      .where(inArray(tenantPackageMenus.menuId, obsoleteMenuIds)),
  ]);
  const remappedRoles = remapCmsMenuBindingRows(legacyRoles, 'roleId');
  const remappedUsers = remapCmsMenuBindingRows(legacyUsers, 'userId');
  const remappedPackages = remapCmsMenuBindingRows(legacyPackages, 'packageId');
  if (remappedRoles.length) await tx.insert(roleMenus).values(remappedRoles as { roleId: number; menuId: number }[]).onConflictDoNothing();
  if (remappedUsers.length) await tx.insert(userMenus).values(remappedUsers as { userId: number; menuId: number }[]).onConflictDoNothing();
  if (remappedPackages.length) {
    await tx.insert(tenantPackageMenus).values(remappedPackages as { packageId: number; menuId: number }[]).onConflictDoNothing();
  }

  await tx.delete(roleMenus).where(inArray(roleMenus.menuId, obsoleteMenuIds));
  await tx.delete(userMenus).where(inArray(userMenus.menuId, obsoleteMenuIds));
  await tx.delete(tenantPackageMenus).where(inArray(tenantPackageMenus.menuId, obsoleteMenuIds));
  await tx.delete(menus).where(inArray(menus.id, obsoleteMenuIds));
  const cmsEditorRoles = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, 'cms_editor'));
  if (cmsEditorRoles.length) {
    await tx.delete(roleMenus).where(and(
      inArray(roleMenus.roleId, cmsEditorRoles.map((role) => role.id)),
      inArray(roleMenus.menuId, [...CMS_RAW_EXPORT_MENU_IDS]),
    ));
  }
  const [retentionConfig] = await tx.select({ id: systemConfigs.id }).from(systemConfigs)
    .where(and(
      eq(systemConfigs.configKey, 'cms_ad_event_retention_days'),
      isNull(systemConfigs.tenantId),
    )).limit(1);
  if (!retentionConfig) {
    await tx.insert(systemConfigs).values({
      configKey: 'cms_ad_event_retention_days',
      configValue: '180',
      configType: 'number',
      description: 'CMS 广告事件明细保留天数，0 表示不自动清理',
      tenantId: null,
    });
  }
}

/** Stage 5 菜单/权限生产同步：站群层级、整组发布与内容分发。 */
export async function applyCmsStage5MenuData(tx: DbTransaction): Promise<void> {
  await applyCmsStage4MenuData(tx);
}

const DATA_MIGRATIONS: AppDataMigration[] = [
  {
    key: '2026-07-cms-stage3-menus-v2',
    description: '同步 CMS Stage3 菜单、1745 发布权限与必要角色绑定',
    run: applyCmsStage3MenuData,
  },
  {
    key: '2026-07-cms-stage4-menus-v2',
    description: '同步 CMS Stage4 菜单权限并安全重映射旧投票角色、用户与租户套餐绑定',
    run: applyCmsStage4MenuData,
  },
  {
    key: '2026-07-cms-stage5-site-groups-v1',
    description: '同步 CMS Stage5 站群层级、整组发布与内容分发菜单权限',
    run: applyCmsStage5MenuData,
  },
];

export async function runAppDataMigrations(db: Db): Promise<string[]> {
  const applied: string[] = [];
  for (const migration of DATA_MIGRATIONS) {
    const didApply = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('zenith-app-data-migrations'))`);
      const [existing] = await tx.select({ key: appDataMigrations.key }).from(appDataMigrations)
        .where(eq(appDataMigrations.key, migration.key)).limit(1);
      if (existing) return false;
      await migration.run(tx);
      await tx.insert(appDataMigrations).values({
        key: migration.key,
        description: migration.description,
      }).onConflictDoNothing({ target: appDataMigrations.key });
      return true;
    });
    if (didApply) applied.push(migration.key);
  }
  return applied;
}
