import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { permissionFeatureKeys } from '@zenith/shared/permission-features';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';

/** Feature boundaries come from the code catalogue, never mutable navigation metadata. */
export async function availablePermissionCodes(codes: readonly string[], tenantId: number | null, tx: DbExecutor = db): Promise<string[]> {
  const features = await getTenantPackageFeatureSet(tenantId, tx);
  return [...new Set(codes)].filter(code => {
    if (!ALL_PERMISSIONS[code]) return false;
    const required = permissionFeatureKeys(code);
    return !features || required.size === 0 || [...required].some(feature => feature === null || features.has(feature));
  }).sort();
}

