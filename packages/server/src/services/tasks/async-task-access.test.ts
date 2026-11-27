import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '../../middleware/auth';
import { asyncTaskScopedWhere, requireGlobalTaskScope } from './public/access';

const state = vi.hoisted(() => ({
  actor: { userId: 27, username: 'tenant-user', roles: ['tenant_admin'], tenantId: 7 } as JwtPayload,
  multiTenant: true,
  permissions: new Set<string>(),
  hasPermission: vi.fn(),
}));

vi.mock('../../config', () => ({ config: { get multiTenantMode() { return state.multiTenant; } } }));
vi.mock('../../lib/context', () => ({
  currentUser: () => state.actor,
  hasPermission: state.hasPermission,
}));

const dialect = new PgDialect({ casing: 'snake_case' });
const column = (name: string) => `"async_tasks"."${name}"`;

beforeEach(() => {
  state.actor = { userId: 27, username: 'tenant-user', roles: ['tenant_admin'], tenantId: 7 };
  state.multiTenant = true;
  state.permissions.clear();
  state.hasPermission.mockReset().mockImplementation(async (permission: string) => state.permissions.has(permission));
});

describe('request access to async tasks', () => {
  it('scopes tenant privileges and always excludes CMS publishing from the generic branch', async () => {
    state.permissions.add('system:async-task:list');
    const read = dialect.sqlToQuery(await asyncTaskScopedWhere());
    expect(read.sql).toContain(`${column('tenant_id')} =`);
    expect(read.sql).not.toContain(column('created_by'));
    expect(read.params).toEqual(['cms-publish-build', 7]);

    const own = dialect.sqlToQuery(await asyncTaskScopedWhere('own'));
    expect(own.sql).toContain(`${column('created_by')} =`);
    expect(own.params).toEqual(['cms-publish-build', 7, 27]);
  });

  it('separates read rights, owner controls, and administrative deletes', async () => {
    state.permissions.add('system:async-task:list');
    const manage = dialect.sqlToQuery(await asyncTaskScopedWhere('manage'));
    expect(manage.params).toEqual(['cms-publish-build', 7, 27]);
    expect(dialect.sqlToQuery(await asyncTaskScopedWhere('remove')).sql).toBe('false');

    state.permissions.add('system:async-task:manage');
    const remove = dialect.sqlToQuery(await asyncTaskScopedWhere('remove'));
    expect(remove.params).toEqual(['cms-publish-build', 7]);
    expect(remove.sql).toContain(`${column('created_by')} is not null`);
  });

  it('limits platform operators to a selected tenant and reserves global writes for platform view', async () => {
    state.actor = { ...state.actor, tenantId: null, roles: ['super_admin'], viewingTenantId: 7 };
    state.permissions.add('system:async-task:list');
    expect(dialect.sqlToQuery(await asyncTaskScopedWhere()).params).toEqual(['cms-publish-build', 7]);
    expect(() => requireGlobalTaskScope()).toThrow('仅平台全局视角');

    state.actor.viewingTenantId = null;
    expect(dialect.sqlToQuery(await asyncTaskScopedWhere()).params).toEqual(['cms-publish-build']);
    expect(() => requireGlobalTaskScope()).not.toThrow();

    state.actor.roles = ['platform-operator'];
    expect(dialect.sqlToQuery(await asyncTaskScopedWhere()).sql).toContain(`${column('tenant_id')} is null`);
    expect(() => requireGlobalTaskScope()).toThrow('仅平台全局视角');
  });

  it('keeps single-tenant permissions and fails closed when permission resolution fails', async () => {
    state.multiTenant = false;
    state.permissions.add('system:async-task:list');
    expect(dialect.sqlToQuery(await asyncTaskScopedWhere()).params).toEqual(['cms-publish-build']);
    expect(() => requireGlobalTaskScope()).not.toThrow();
    state.hasPermission.mockRejectedValueOnce(new Error('permission store unavailable'));
    await expect(asyncTaskScopedWhere()).rejects.toThrow('permission store unavailable');
  });
});
