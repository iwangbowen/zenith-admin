import type { Role } from '@zenith/shared';
import { SEED_ROLES } from '@zenith/shared';

export const mockRoles: Role[] = SEED_ROLES.map((r) => ({ ...r }));

let nextRoleId = 3;
export function getNextRoleId() {
  return nextRoleId++;
}
