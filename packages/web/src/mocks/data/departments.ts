import type { Department } from '@zenith/shared';
import { SEED_DEPARTMENTS } from '@zenith/shared';

export const mockDepartments: Department[] = SEED_DEPARTMENTS.map((d) => ({ ...d }));

let nextDeptId = SEED_DEPARTMENTS.length + 1;
export function getNextDeptId() {
  return nextDeptId++;
}
