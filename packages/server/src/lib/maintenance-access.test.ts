import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ multiTenantMode: false, subject: undefined as unknown, permissions: [] as string[] }));
vi.mock('../config', () => ({ config: state }));
vi.mock('../db', () => ({ db: { query: { users: { findFirst: async () => state.subject } } } }));
vi.mock('./permissions', () => ({ getUserPermissions: async () => state.permissions, runWithFreshUserPermissions: async (_id: number, work: () => unknown) => work() }));
import { maintenanceAccess } from './maintenance-access';
const user = { userId: 1, username: 'operator', tenantId: null, roles: ['super_admin'] };
const subject = (superAdmin = false) => ({ tenantId: null, status: 'enabled', userRoles: superAdmin ? [{ role: { code: 'super_admin', status: 'enabled', tenantId: null } }] : [], userGroupMembers: [] });
beforeEach(() => { state.multiTenantMode = false; state.subject = subject(); state.permissions = []; });
describe('live maintenance capabilities', () => {
  it('does not trust the super_admin claim after its role is removed', async () => {
    expect((await maintenanceAccess(user)).canBypass).toBe(false);
    state.subject = subject(true);
    expect((await maintenanceAccess(user)).canBypass).toBe(true);
  });
  it('separates manager and bypass capabilities', async () => {
    state.permissions = ['system:maintenance:manage'];
    expect(await maintenanceAccess(user)).toEqual({ canView: true, canManage: true, canViewLogs: true, canBypass: false });
    state.permissions = ['system:maintenance:bypass'];
    expect(await maintenanceAccess(user)).toEqual({ canView: false, canManage: false, canViewLogs: false, canBypass: true });
  });
  it('rejects inactive accounts and tenant managers in multi-tenant deployments', async () => {
    state.multiTenantMode = true; state.permissions = ['system:maintenance:manage','system:maintenance:bypass'];
    expect((await maintenanceAccess(user)).canManage).toBe(false);
    state.subject = { ...subject(true), status: 'disabled' };
    expect((await maintenanceAccess(user)).canBypass).toBe(false);
  });
  it('never gives impersonation management or business passage', async () => {
    state.subject = subject(true);
    const result = await maintenanceAccess({ ...user, impersonation: { id: 1, byUserId: 2, byUsername: 'admin', readOnly: false } });
    expect(result.canManage).toBe(false); expect(result.canBypass).toBe(false);
  });
});
