import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../../db/types';

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../messaging/notification-outbox.service', () => ({ notify: vi.fn() }));

import { assertNoOverlappingAccessRequest } from './access-reservations.service';

const requestedItem = {
  itemType: 'permission' as const,
  roleId: null,
  menuId: 10,
  permissionCode: 'system:user:assign',
  permissionLabel: '用户授权',
  dataScope: null,
  deptScopeIds: [],
  snapshot: {},
};

function executorWith(options: { grants?: unknown[]; requests?: unknown[] } = {}) {
  return {
    query: {
      identityAccessGrants: { findMany: vi.fn().mockResolvedValue(options.grants ?? []) },
      identityAccessRequests: { findMany: vi.fn().mockResolvedValue(options.requests ?? []) },
    },
  } as unknown as DbExecutor;
}

const input = {
  targetUserId: 7,
  tenantId: null,
  startsAt: new Date('2026-10-18T08:00:00Z'),
  expiresAt: new Date('2026-10-18T12:00:00Z'),
  items: [requestedItem],
};

describe('access request overlap guard', () => {
  it('treats a permanent request as overlapping a future grant of the same permission', async () => {
    const future = new Date(input.expiresAt.getTime() + 86_400_000);
    const executor = executorWith({ grants: [{ items: [{ ...requestedItem, id: 1, status: 'scheduled', startsAt: future, expiresAt: null }] }] });
    await expect(assertNoOverlappingAccessRequest({ ...input, expiresAt: null }, executor)).rejects.toMatchObject({ status: 409 });
    await expect(assertNoOverlappingAccessRequest(input, executor)).resolves.toBeUndefined();
  });

  it('does not conflict with revoked items or disjoint custom department ranges', async () => {
    const existing = { ...requestedItem, id: 1, status: 'active', startsAt: input.startsAt, expiresAt: null, dataScope: 'custom', deptScopeIds: [1] };
    const executor = executorWith({ grants: [{ items: [existing, { ...existing, status: 'revoked', dataScope: 'all' }] }] });
    await expect(assertNoOverlappingAccessRequest({ ...input, items: [{ ...requestedItem, dataScope: 'custom', deptScopeIds: [2] }] }, executor)).resolves.toBeUndefined();
  });

  it('rejects a permission already covered by an effective grant', async () => {
    const executor = executorWith({ grants: [{ items: [{ ...requestedItem, id: 1, status: 'active', startsAt: input.startsAt, expiresAt: input.expiresAt }] }] });

    await expect(assertNoOverlappingAccessRequest(input, executor)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('用户授权'),
    });
  });

  it('rejects a permission already present in a pending request', async () => {
    const executor = executorWith({ requests: [{ items: [{ ...requestedItem }] }] });

    await expect(assertNoOverlappingAccessRequest(input, executor)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('请勿重复申请'),
    });
  });

  it('allows unrelated permissions', async () => {
    const executor = executorWith({ grants: [{ items: [{ ...requestedItem, menuId: 11, permissionCode: 'system:menu:list', status: 'active', startsAt: input.startsAt, expiresAt: input.expiresAt }] }], requests: [{ items: [{ ...requestedItem, menuId: 12, permissionCode: 'system:role:list' }] }] });

    await expect(assertNoOverlappingAccessRequest(input, executor)).resolves.toBeUndefined();
  });

  it('allows an independent grant and another page using the same read code', async () => {
    const executor = executorWith({ requests: [{ items: [
      { ...requestedItem, menuId: null },
      { ...requestedItem, menuId: 11 },
    ] }] });
    await expect(assertNoOverlappingAccessRequest(input, executor)).resolves.toBeUndefined();
  });
});
