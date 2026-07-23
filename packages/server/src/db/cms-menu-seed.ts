import { sql } from 'drizzle-orm';
import { menus } from './schema';
import type { DbExecutor } from './types';

export type MenuSeedRow = {
  id: number;
  parentId: number;
  title: string;
  name?: string;
  path?: string;
  component?: string;
  icon?: string;
  type: 'directory' | 'menu' | 'button';
  permission?: string;
  sort: number;
  status: 'enabled' | 'disabled';
  visible: boolean;
};

export function mapMenuSeedRows(rows: readonly MenuSeedRow[]) {
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    name: row.name ?? null,
    path: row.path ?? null,
    component: row.component ?? null,
    icon: row.icon ?? null,
    type: row.type,
    permission: row.permission ?? null,
    sort: row.sort,
    status: row.status,
    visible: row.visible,
  }));
}

export async function upsertCmsMenuSeedRows(executor: DbExecutor, rows: ReturnType<typeof mapMenuSeedRows>) {
  const cmsRows = rows.filter((row) => row.id >= 1700 && row.id < 1900);
  await executor.insert(menus).values(cmsRows).onConflictDoUpdate({
    target: menus.id,
    set: {
      parentId: sql`excluded.parent_id`,
      title: sql`excluded.title`,
      name: sql`excluded.name`,
      path: sql`excluded.path`,
      component: sql`excluded.component`,
      icon: sql`excluded.icon`,
      type: sql`excluded.type`,
      permission: sql`excluded.permission`,
      sort: sql`excluded.sort`,
      status: sql`excluded.status`,
      visible: sql`excluded.visible`,
    },
  });
}
