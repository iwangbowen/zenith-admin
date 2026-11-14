import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: { id: 7, username: 'creator', tenantId: 2 as number | null, status: 'enabled', userRoles: [{ role: { code: 'user', status: 'enabled' } }] },
  tenant: { status: 'enabled', expireAt: null as Date | null }, permitted: true, scope: vi.fn(), fresh: vi.fn(),
}));
vi.mock('../../db', () => ({ db: { query: { users: { findFirst: async () => state.user }, tenants: { findFirst: async () => state.tenant } } } }));
vi.mock('../context', () => ({ currentUser: () => ({ userId: 7 }), hasPermission: async () => state.permitted, runWithCurrentUser: (user: unknown, work: () => unknown) => { state.scope(user); return work(); } }));
vi.mock('../permissions', () => ({ isSuperAdmin: (user: { roles: string[]; tenantId: number | null }) => user.tenantId === null && user.roles.includes('super_admin'), runWithFreshUserPermissions: (_id: number, work: () => unknown) => { state.fresh(); return work(); } }));
vi.mock('./registry', () => ({ getImportDefinition: () => ({ permission: 'test:import' }) }));
import { withImportAuthorization } from './authorization';
beforeEach(() => { state.user = { id: 7, username: 'creator', tenantId: 2, status: 'enabled', userRoles: [{ role: { code: 'user', status: 'enabled' } }] }; state.permitted = true; state.tenant = { status: 'enabled', expireAt: null }; vi.clearAllMocks(); });
it('restores a platform creator tenant view and checks fresh permissions before processing', async () => {
  state.user.tenantId = null; state.user.userRoles[0].role.code = 'super_admin';
  expect(await withImportAuthorization({ tenantId: 2, payload: { entity: 'test' } }, async () => 'done')).toBe('done');
  expect(state.scope).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, tenantId: null, viewingTenantId: 2 }));
  expect(state.fresh).toHaveBeenCalledOnce();
});
it.each(['disabled', 'moved', 'revoked', 'expired'])('rejects %s creators before business work', async reason => {
  if (reason === 'disabled') state.user.status = 'disabled';
  if (reason === 'moved') state.user.tenantId = 3;
  if (reason === 'revoked') state.permitted = false;
  if (reason === 'expired') state.tenant.expireAt = new Date('2000-01-01');
  const work = vi.fn();
  await expect(withImportAuthorization({ tenantId: 2, payload: { entity: 'test' } }, work)).rejects.toThrow();
  expect(work).not.toHaveBeenCalled();
});
