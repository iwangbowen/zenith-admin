/**
 * 自动建号角色授予不变式：
 * - 保存时（assertDefaultRolesGrantable）：调用者可见 + 归属目标租户 + 非平台保留角色；
 * - 落库时（resolveGrantableDefaultRoleIds）：再过滤一遍存在 / 启用 / 归属 / 非保留。
 * 与调用者身份无关的第 ③ 条是 C1（租户管理员经 JIT / SCIM 铸造平台超管）的核心防线。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  return { db };
});

vi.mock('../../lib/redis', () => ({
  default: { get: vi.fn(), set: vi.fn(), del: vi.fn(), scan: vi.fn() },
}));

vi.mock('../../lib/context', () => ({ currentUser: vi.fn() }));

vi.mock('../../lib/tenant', () => ({
  exactTenantCondition: vi.fn(() => undefined),
  isPlatformAdmin: vi.fn(),
  tenantCondition: vi.fn(),
}));

import { db } from '../../db';
import { currentUser } from '../../lib/context';
import { isPlatformAdmin, tenantCondition } from '../../lib/tenant';
import type { JwtPayload } from '../../middleware/auth';
import {
  RESERVED_ROLE_CODES,
  assertDefaultRolesGrantable,
  resolveGrantableDefaultRoleIds,
  userHasPlatformSuperRole,
  listPlatformSuperUserIds,
} from './role-grant';

const dbMock = vi.mocked(db);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'innerJoin', 'orderBy']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

async function expectHttpError(fn: () => Promise<unknown>, status: number, message: string) {
  try {
    await fn();
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(status);
    expect((err as HTTPException).message).toBe(message);
  }
}

const tenantAdmin = { userId: 10, username: 'ta', roles: ['tenant_admin'], tenantId: 3 } as unknown as JwtPayload;
const platformAdmin = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null } as unknown as JwtPayload;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(tenantCondition).mockReturnValue(undefined);
});

describe('RESERVED_ROLE_CODES', () => {
  it('contains the platform super admin code', () => {
    expect(RESERVED_ROLE_CODES.has('super_admin')).toBe(true);
  });
});

describe('assertDefaultRolesGrantable', () => {
  it('skips the database entirely for an empty list', async () => {
    vi.mocked(currentUser).mockReturnValue(tenantAdmin);
    await assertDefaultRolesGrantable([], 3);
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('tenant admin: applies the caller tenant condition and rejects roles outside it', async () => {
    vi.mocked(currentUser).mockReturnValue(tenantAdmin);
    vi.mocked(isPlatformAdmin).mockReturnValue(false);
    vi.mocked(tenantCondition).mockReturnValue({ op: 'tenant' } as never);
    // 请求 2 个角色，作用域内只查到 1 个（另一个是平台角色，被 tenantCondition 过滤掉）
    const chain = createChain([{ id: 5, code: 'editor', tenantId: 3 }]);
    dbMock.select.mockReturnValueOnce(chain);

    await expectHttpError(() => assertDefaultRolesGrantable([5, 1], 3), 400, '默认角色不存在或不属于目标租户');
    expect(tenantCondition).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  it('platform admin: does not apply a caller tenant condition (can configure any tenant)', async () => {
    vi.mocked(currentUser).mockReturnValue(platformAdmin);
    vi.mocked(isPlatformAdmin).mockReturnValue(true);
    dbMock.select.mockReturnValueOnce(createChain([{ id: 5, code: 'editor', tenantId: 3 }]));

    await expect(assertDefaultRolesGrantable([5], 3)).resolves.toBeUndefined();
    expect(tenantCondition).not.toHaveBeenCalled();
  });

  it('rejects roles that belong to a different tenant than the target', async () => {
    vi.mocked(currentUser).mockReturnValue(platformAdmin);
    vi.mocked(isPlatformAdmin).mockReturnValue(true);
    // 平台角色（tenantId null）挂到租户 3 的身份源上 → 租户 JIT 用户会拿到平台角色
    dbMock.select.mockReturnValueOnce(createChain([{ id: 8, code: 'ops', tenantId: null }]));

    await expectHttpError(() => assertDefaultRolesGrantable([8], 3), 400, '默认角色不存在或不属于目标租户');
  });

  it('rejects the platform super admin role even for a platform admin configuring a platform-level provider', async () => {
    vi.mocked(currentUser).mockReturnValue(platformAdmin);
    vi.mocked(isPlatformAdmin).mockReturnValue(true);
    dbMock.select.mockReturnValueOnce(createChain([
      { id: 1, code: 'super_admin', tenantId: null },
      { id: 2, code: 'ops', tenantId: null },
    ]));

    await expectHttpError(
      () => assertDefaultRolesGrantable([1, 2], null),
      400,
      '自动建号不允许授予平台保留角色，请由平台管理员手动授予',
    );
  });

  it('de-duplicates ids before comparing counts', async () => {
    vi.mocked(currentUser).mockReturnValue(platformAdmin);
    vi.mocked(isPlatformAdmin).mockReturnValue(true);
    dbMock.select.mockReturnValueOnce(createChain([{ id: 5, code: 'editor', tenantId: 3 }]));

    await expect(assertDefaultRolesGrantable([5, 5, 5], 3)).resolves.toBeUndefined();
  });
});

describe('resolveGrantableDefaultRoleIds', () => {
  it('returns [] without touching the database for an empty list', async () => {
    expect(await resolveGrantableDefaultRoleIds([], 3)).toEqual([]);
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('returns only the ids the filtered query yields (reserved / disabled / foreign roles dropped by SQL)', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ id: 2 }]));
    expect(await resolveGrantableDefaultRoleIds([1, 2, 2, 9], 3)).toEqual([2]);
  });

  it('uses the supplied executor so it can run inside the creating transaction', async () => {
    const tx = { select: vi.fn().mockReturnValueOnce(createChain([{ id: 4 }])) };
    expect(await resolveGrantableDefaultRoleIds([4], null, tx as never)).toEqual([4]);
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});

describe('platform super role lookups', () => {
  it('userHasPlatformSuperRole reflects whether the join finds a row', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ userId: 1 }]));
    expect(await userHasPlatformSuperRole(1)).toBe(true);
    dbMock.select.mockReturnValueOnce(createChain([]));
    expect(await userHasPlatformSuperRole(2)).toBe(false);
  });

  it('listPlatformSuperUserIds returns a set of user ids', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{ userId: 1 }, { userId: 7 }]));
    const ids = await listPlatformSuperUserIds();
    expect([...ids].sort()).toEqual([1, 7]);
  });
});
