import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { SEED_MENUS } from '@zenith/shared/seed/menus';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';

const featuresByPermission = new Map<string, Array<string | null>>();
for (const menu of SEED_MENUS) {
  if (!menu.permission) continue;
  const features = featuresByPermission.get(menu.permission) ?? [];
  features.push(menu.featureKey ?? null);
  featuresByPermission.set(menu.permission, features);
}

/** Feature boundaries come from the code catalogue, never mutable navigation metadata. */
export async function availablePermissionCodes(codes: readonly string[], tenantId: number | null, tx: DbExecutor = db): Promise<string[]> {
  const features = await getTenantPackageFeatureSet(tenantId, tx);
  return [...new Set(codes)].filter(code => {
    if (!ALL_PERMISSIONS[code]) return false;
    const required = featuresByPermission.get(code) ?? [];
    return !features || required.some(feature => feature === null || features.has(feature));
  }).sort();
}

