import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { isPermissionAvailable } from '../../lib/page-access';

/** Feature boundaries come from the code catalogue, never mutable navigation metadata. */
export async function availablePermissionCodes(codes: readonly string[], tenantId: number | null, tx: DbExecutor = db): Promise<string[]> {
  const features = await getTenantPackageFeatureSet(tenantId, tx);
  return [...new Set(codes)].filter(code => isPermissionAvailable(code, features)).sort();
}

