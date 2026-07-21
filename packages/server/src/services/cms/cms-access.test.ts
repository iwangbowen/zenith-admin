import { describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '../../middleware/auth';

vi.mock('../../lib/context', () => ({ currentUser: vi.fn() }));
vi.mock('../../lib/permissions', () => ({
  isSuperAdmin: (user: JwtPayload) =>
    user.roles.includes('super_admin') && user.tenantId === null,
}));

import {
  assertCompleteCmsBatch, canAccessBoundCmsObject, isCmsPlatformAdmin,
} from './cms-access';

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 10,
    username: 'editor',
    roles: ['cms_editor'],
    tenantId: 7,
    ...overrides,
  };
}

describe('global CMS ACL policy', () => {
  it('does not trust a tenant role named super_admin as platform super admin', () => {
    const spoofed = user({ roles: ['super_admin'], tenantId: 7 });
    expect(isCmsPlatformAdmin(spoofed)).toBe(false);
    expect(canAccessBoundCmsObject({
      user: spoofed,
      objectId: 3,
      boundIds: [],
    })).toBe(false);
  });

  it('fails closed when a non-platform user has no explicit object binding', () => {
    expect(canAccessBoundCmsObject({
      user: user(),
      objectId: 3,
      boundIds: [],
    })).toBe(false);
    expect(canAccessBoundCmsObject({
      user: user(),
      objectId: 3,
      boundIds: [3],
    })).toBe(true);
  });

  it('requires both site and channel grants for detail/version/preview style content access', () => {
    const editor = user();
    const siteGranted = canAccessBoundCmsObject({
      user: editor,
      objectId: 11,
      boundIds: [11],
    });
    const channelDenied = canAccessBoundCmsObject({
      user: editor,
      objectId: 21,
      boundIds: [22],
    });
    expect(siteGranted && channelDenied).toBe(false);
  });

  it('lets the platform super admin bypass bindings without a tenant selector', () => {
    const platform = user({ roles: ['super_admin'], tenantId: null });
    expect(isCmsPlatformAdmin(platform)).toBe(true);
    expect(canAccessBoundCmsObject({
      user: platform,
      objectId: 999,
      boundIds: [],
    })).toBe(true);
  });

  it('rejects partial batch resolution instead of authorizing only the first object', () => {
    expect(() => assertCompleteCmsBatch([1, 2], [1], '内容')).toThrow();
    expect(assertCompleteCmsBatch([1, 2, 2], [2, 1], '内容')).toEqual([1, 2]);
  });
});
