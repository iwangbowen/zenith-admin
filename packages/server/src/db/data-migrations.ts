import { eq, inArray, sql } from 'drizzle-orm';
import { SEED_MENUS } from '@zenith/shared';
import type { Db, DbTransaction } from './types';
import { appDataMigrations, roleMenus, roles } from './schema';
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
  const roleRows = await tx.select({ id: roles.id }).from(roles)
    .where(inArray(roles.code, ['super_admin', 'cms_editor']));
  if (roleRows.length && cmsMenuIds.length) {
    await tx.insert(roleMenus)
      .values(roleRows.flatMap((role) => cmsMenuIds.map((menuId) => ({ roleId: role.id, menuId }))))
      .onConflictDoNothing();
  }
}

const DATA_MIGRATIONS: AppDataMigration[] = [{
  key: '2026-07-cms-stage3-menus-v2',
  description: '同步 CMS Stage3 菜单、1745 发布权限与必要角色绑定',
  run: applyCmsStage3MenuData,
}];

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
