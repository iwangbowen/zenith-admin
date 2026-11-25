import { beforeEach, describe, expect, it, vi } from 'vitest';

const packageFeatureMock = vi.hoisted(() => ({
  getTenantPackageFeatureSet: vi.fn(),
}));

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../lib/tenant-package', () => packageFeatureMock);

import { availablePermissionCodes } from './permission-catalog.service';

describe('availablePermissionCodes', () => {
  beforeEach(() => vi.resetAllMocks());

  it('uses operation page bindings when applying a tenant package', async () => {
    packageFeatureMock.getTenantPackageFeatureSet.mockResolvedValue(new Set(['workflow']));

    await expect(availablePermissionCodes([
      'system:process:view',
      'workflow:definition:list',
      'system:user:list',
    ], 9)).resolves.toEqual(['system:user:list', 'workflow:definition:list']);
  });

  it('keeps page-less core permissions available in a restricted package', async () => {
    packageFeatureMock.getTenantPackageFeatureSet.mockResolvedValue(new Set(['workflow']));

    await expect(availablePermissionCodes(['system:login-risk:list'], 9)).resolves.toEqual(['system:login-risk:list']);
  });
});
