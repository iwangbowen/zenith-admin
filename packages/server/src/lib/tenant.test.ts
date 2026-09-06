import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { isPlatformAdmin, getEffectiveTenantId, tenantCondition, resolveManagedTenantId, isTenantActive, isTenantExpired, exactTenantCondition, optionalExactTenantCondition, inheritedTenantCondition } from './tenant';
import { config } from '../config';
import { currentUser } from './context';
import type { JwtPayload } from '../middleware/auth';

vi.mock('../config', () => ({
  config: { multiTenantMode: true, log: { level: 'silent', dir: 'logs', maxFiles: '30d' } }
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ op: 'eq', col, val })),
  isNull: vi.fn((col) => ({ op: 'isNull', col })),
  or: vi.fn((...conds) => ({ op: 'or', conds })),
  // schema.ts 导入 relations 定义各表关系；mock 返回空对象即可（tenant 逻辑不依赖关系）
  relations: vi.fn(() => ({})),
}));

// tenant.ts 在 line 64 `import { currentUser } from './context'`，而 context.ts 运行时
// `import { db } from '../db'` + `import { users, departments } from '../db/schema'`，
// 会触发 db/index 真实连接（config.database.*）与 schema relations。mock context 切断该链；
// 本单测仅验证显式传参版函数（tenantCondition(table, user) 等），不依赖 currentUser。
vi.mock('./context', () => ({ currentUser: vi.fn() }));

describe('tenant utility', () => {
  beforeEach(() => {
    config.multiTenantMode = true;
  });

  describe('isTenantExpired / isTenantActive', () => {
    const now = new Date('2025-01-01T00:00:00Z');

    it('treats null expireAt as never expired', () => {
      expect(isTenantExpired({ expireAt: null }, now)).toBe(false);
      expect(isTenantExpired({ expireAt: undefined }, now)).toBe(false);
    });

    it('expires exactly at expireAt (closed boundary) and afterwards', () => {
      expect(isTenantExpired({ expireAt: new Date(now.getTime()) }, now)).toBe(true);
      expect(isTenantExpired({ expireAt: new Date(now.getTime() - 1) }, now)).toBe(true);
      expect(isTenantExpired({ expireAt: new Date(now.getTime() + 1) }, now)).toBe(false);
    });

    it('is active only when enabled and not expired', () => {
      expect(isTenantActive({ status: 'enabled', expireAt: null }, now)).toBe(true);
      expect(isTenantActive({ status: 'enabled', expireAt: new Date(now.getTime() + 1) }, now)).toBe(true);
      expect(isTenantActive({ status: 'enabled', expireAt: now }, now)).toBe(false);
      expect(isTenantActive({ status: 'disabled', expireAt: null }, now)).toBe(false);
      expect(isTenantActive({ status: null, expireAt: null }, now)).toBe(false);
    });
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

  describe('resolveManagedTenantId', () => {
    const asUser = (user: Partial<JwtPayload>) => vi.mocked(currentUser).mockReturnValue(user as JwtPayload);
    const platformAdmin = { roles: ['super_admin'], tenantId: null };
    const tenantAdmin = { roles: ['tenant_admin'], tenantId: 3 };

    it('platform admin: explicit value wins (null = platform level), omitted falls back to current view', () => {
      asUser({ ...platformAdmin, viewingTenantId: 5 });
      expect(resolveManagedTenantId(undefined)).toBe(5);
      expect(resolveManagedTenantId(null)).toBeNull();
      expect(resolveManagedTenantId(7)).toBe(7);
      asUser(platformAdmin);
      expect(resolveManagedTenantId(undefined)).toBeNull();
    });

    it('tenant user: always lands in own tenant', () => {
      asUser(tenantAdmin);
      expect(resolveManagedTenantId(undefined)).toBe(3);
      expect(resolveManagedTenantId(3)).toBe(3);
    });

    it('tenant user: platform level (null) or another tenant is rejected with 403', () => {
      asUser(tenantAdmin);
      for (const requested of [null, 9]) {
        try {
          resolveManagedTenantId(requested, '无权配置');
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(HTTPException);
          expect((err as HTTPException).status).toBe(403);
          expect((err as HTTPException).message).toBe('无权配置');
        }
      }
    });

    it('tenant user with a forged super_admin role code is still not a platform admin', () => {
      // isPlatformAdmin 要求 tenantId 为空；租户自建的 super_admin 同名角色不能解锁平台级归属
      asUser({ roles: ['super_admin'], tenantId: 3 });
      expect(resolveManagedTenantId(undefined)).toBe(3);
      expect(() => resolveManagedTenantId(null)).toThrow(HTTPException);
    });

    it('single-tenant mode: everyone is in the global scope, explicit tenant ids are rejected', () => {
      config.multiTenantMode = false;
      asUser({ roles: ['admin'], tenantId: null });
      expect(resolveManagedTenantId(undefined)).toBeNull();
      expect(resolveManagedTenantId(null)).toBeNull();
      expect(() => resolveManagedTenantId(2)).toThrow(HTTPException);
    });
  });
});

describe('exact / inherited tenant conditions', () => {
  const column = { name: 'tenant_id' };

  it('exactTenantCondition：null 与 undefined → IS NULL，数字 → =', () => {
    expect(exactTenantCondition(column as never, null)).toEqual({ op: 'isNull', col: column });
    expect(exactTenantCondition(column as never, undefined as unknown as null)).toEqual({ op: 'isNull', col: column });
    expect(exactTenantCondition(column as never, 7)).toEqual({ op: 'eq', col: column, val: 7 });
  });

  it('optionalExactTenantCondition：undefined 表示不过滤', () => {
    expect(optionalExactTenantCondition(column as never, undefined)).toBeUndefined();
    expect(optionalExactTenantCondition(column as never, null)).toEqual({ op: 'isNull', col: column });
    expect(optionalExactTenantCondition(column as never, 3)).toEqual({ op: 'eq', col: column, val: 3 });
  });

  it('inheritedTenantCondition：null → IS NULL，数字 → IS NULL OR =', () => {
    expect(inheritedTenantCondition(column as never, null)).toEqual({ op: 'isNull', col: column });
    expect(inheritedTenantCondition(column as never, 5)).toEqual({ op: 'or', conds: [{ op: 'isNull', col: column }, { op: 'eq', col: column, val: 5 }] });
  });
});
