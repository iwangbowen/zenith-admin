import { SEED_TENANTS } from '@zenith/shared/seed';
import type { Tenant } from '@zenith/shared/identity';
import { nextIdFrom } from '@/mocks/utils/handlers';

let nextTenantId = nextIdFrom(SEED_TENANTS);
export function getNextTenantId() { return nextTenantId++; }

export const mockTenants: Tenant[] = SEED_TENANTS.map((t, i) => ({
  ...t,
  // Demo 演示：第一个租户显示到期日期
  expireAt: i === 0 ? '2027-12-31 23:59:59' : null,
}));
