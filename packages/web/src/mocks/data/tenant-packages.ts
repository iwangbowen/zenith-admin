import { SEED_TENANT_PACKAGES } from '@zenith/shared/seed';
import type { TenantPackage } from '@zenith/shared/identity';
import { nextIdFrom } from '@/mocks/utils/handlers';

let nextTenantPackageId = nextIdFrom(SEED_TENANT_PACKAGES);
export function getNextTenantPackageId() { return nextTenantPackageId++; }

export const mockTenantPackages: TenantPackage[] = SEED_TENANT_PACKAGES.map((p) => ({
  ...p,
  features: p.features ?? [],
  featureCount: (p.features ?? []).length,
  quotas: p.quotas ?? null,
}));
