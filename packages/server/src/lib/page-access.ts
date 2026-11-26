import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { isPageReadPermission, permissionFeatureKeys } from '@zenith/shared/permission-features';
import { SETTINGS_MODULES } from '@zenith/shared/settings';
import { config } from '../config';
import { menus } from '../db/schema';
import type { DbExecutor } from '../db/types';

type PageRow = Pick<typeof menus.$inferSelect, 'id' | 'parentId' | 'title' | 'type' | 'status' | 'featureKey' | 'path' | 'permission'>;

const platformPaths = new Set(['/system/maintenance', ...Object.values(SETTINGS_MODULES)
  .flatMap(setting => setting.platformOnly && setting.page ? [setting.page] : [])]);

export function isPermissionAvailable(code: string, features: ReadonlySet<string> | null): boolean {
  if (!Object.hasOwn(ALL_PERMISSIONS, code)) return false;
  const keys = permissionFeatureKeys(code);
  return features === null || keys.size === 0 || [...keys].some(key => key === null || features.has(key));
}

/** Pages and their ancestors must be enabled and available in the same tenant. */
export function availableNavigation<T extends PageRow>(rows: readonly T[], features: ReadonlySet<string> | null, platform: boolean): T[] {
  const allowed = new Map(rows.filter(row => row.status === 'enabled'
    && (!features || !row.featureKey || features.has(row.featureKey))
    && (!config.multiTenantMode || platform || !row.path || !platformPaths.has(row.path))).map(row => [row.id, row]));
  return [...allowed.values()].filter(row => {
    const seen = new Set([row.id]);
    let parentId = row.parentId;
    while (parentId !== 0) {
      const parent = allowed.get(parentId);
      if (!parent || seen.has(parentId)) return false;
      seen.add(parentId);
      parentId = parent.parentId;
    }
    return true;
  });
}

export function readPageAccessRows(executor: DbExecutor): PromiseLike<PageRow[]> {
  return executor.select({
    id: menus.id, parentId: menus.parentId, title: menus.title, type: menus.type, status: menus.status,
    featureKey: menus.featureKey, path: menus.path, permission: menus.permission,
  }).from(menus);
}

export function getPageReadCode(page: Pick<PageRow, 'type' | 'permission'>): string | null {
  return page.type === 'menu' && page.permission && isPageReadPermission(page.permission) ? page.permission : null;
}
