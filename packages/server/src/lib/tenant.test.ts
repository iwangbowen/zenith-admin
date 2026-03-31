import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPlatformAdmin, getEffectiveTenantId, tenantCondition } from './tenant';
import { config } from '../config';
import type { JwtPayload } from '../middleware/auth';

vi.mock('../config', () => ({
  config: { multiTenantMode: true }
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ op: 'eq', col, val })),
  isNull: vi.fn((col) => ({ op: 'isNull', col }))
}));

describe('tenant utility', () => {
  beforeEach(() => {
    config.multiTenantMode = true;
  });

  describe('isPlatformAdmin', () => {
    it('returns true if role is super_admin and tenantId is null', () => {
      expect(isPlatformAdmin({ roles: ['super_admin'], tenantId: null } as unknown as JwtPayload)).toBe(true);
    });

    it('returns false if tenantId is not null', () => {
      expect(isPlatformAdmin({ roles: ['super_admin'], tenantId: 1 } as unknown as JwtPayload)).toBe(false);
    });

    it('returns false if role does not include super_admin', () => {
      expect(isPlatformAdmin({ roles: ['admin'], tenantId: null } as unknown as JwtPayload)).toBe(false);
    });

    it('returns false if user is missing roles', () => {
      expect(isPlatformAdmin({ roles: [], tenantId: null } as unknown as JwtPayload)).toBe(false);
    });
  });

  describe('getEffectiveTenantId', () => {
    it('returns null if multiTenantMode is false', () => {
      config.multiTenantMode = false;
      expect(getEffectiveTenantId({ tenantId: 1 } as unknown as JwtPayload)).toBe(null);
    });

    it('returns viewingTenantId if user is platform admin and it is set', () => {
      expect(
        getEffectiveTenantId({ roles: ['super_admin'], tenantId: null, viewingTenantId: 5 } as unknown as JwtPayload)
      ).toBe(5);
    });

    it('returns null if platform admin and viewingTenantId is not set', () => {
      expect(
        getEffectiveTenantId({ roles: ['super_admin'], tenantId: null } as unknown as JwtPayload)
      ).toBe(null);
    });

    it('returns tenantId for normal users', () => {
      expect(getEffectiveTenantId({ roles: ['admin'], tenantId: 2 } as unknown as JwtPayload)).toBe(2);
    });
  });

  describe('tenantCondition', () => {
    it('returns undefined if multiTenantMode is false', () => {
      config.multiTenantMode = false;
      expect(tenantCondition({ tenantId: 'tenantCol' }, { tenantId: 1 } as unknown as JwtPayload)).toBeUndefined();
    });

    it('returns undefined if user is platform admin without viewingTenantId', () => {
      expect(
        tenantCondition({ tenantId: 'tenantCol' }, { roles: ['super_admin'], tenantId: null } as unknown as JwtPayload)
      ).toBeUndefined();
    });

    it('returns isNull condition if effectiveTenantId is null', () => {
      // Create a user that evaluates to null effectiveTenantId but is not a platform admin (edge case or malformed)
      const cond = tenantCondition({ tenantId: 'tenantCol' }, { roles: [], tenantId: null } as unknown as JwtPayload);
      expect(cond).toEqual({ op: 'isNull', col: 'tenantCol' });
    });

    it('returns eq condition if effectiveTenantId has a value', () => {
      const cond = tenantCondition({ tenantId: 'tenantCol' }, { roles: [], tenantId: 3 } as unknown as JwtPayload);
      expect(cond).toEqual({ op: 'eq', col: 'tenantCol', val: 3 });
    });

    it('returns eq condition with viewingTenantId for platform admin', () => {
      const cond = tenantCondition(
        { tenantId: 'tenantCol' },
        { roles: ['super_admin'], tenantId: null, viewingTenantId: 4 } as unknown as JwtPayload
      );
      expect(cond).toEqual({ op: 'eq', col: 'tenantCol', val: 4 });
    });
  });
});
