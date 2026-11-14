import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { JwtPayload } from '../../middleware/auth';
const state = vi.hoisted(() => ({ user: { userId: 7, username: 'test', tenantId: 2, roles: [] } as JwtPayload, permissions: [] as string[], find: vi.fn() }));
vi.mock('../../config', async importOriginal => { const actual = await importOriginal<typeof import('../../config')>(); return { ...actual, config: { ...actual.config, multiTenantMode: true } }; });
vi.mock('../../db', () => ({ db: { query: { exportJobs: { findFirst: state.find } } } }));
vi.mock('../../lib/context', () => ({ currentUser: () => state.user }));
vi.mock('../../lib/permissions', () => ({ getUserPermissions: async () => state.permissions, isSuperAdmin: (user: JwtPayload) => user.roles.includes('super_admin') && user.tenantId === null }));
import { getExportJob } from './export-jobs.service';
beforeEach(() => { state.find.mockReset().mockResolvedValue(undefined); state.user = { userId: 7, username: 'test', tenantId: 2, roles: [] }; state.permissions = []; });
async function predicate() {
  await expect(getExportJob(9)).rejects.toMatchObject({ status: 404 });
  return new PgDialect({ casing: 'snake_case' }).sqlToQuery(state.find.mock.calls[0][0].where);
}
it('requires both ownership and the current tenant for an ordinary user', async () => {
  const where = await predicate();
  expect(where.sql).toContain('created_by');
  expect(where.sql).toContain('tenant_id');
  expect(where.params).toContain(2);
});
it('keeps manage-all constrained to the acting tenant', async () => {
  state.permissions = ['system:export-job:manage'];
  const where = await predicate();
  expect(where.sql).not.toContain('created_by');
  expect(where.sql).toContain('tenant_id');
  expect(where.params).toContain(2);
});
it('honors the selected tenant view for a platform super administrator', async () => {
  state.user = { userId: 1, username: 'admin', tenantId: null, viewingTenantId: 5, roles: ['super_admin'] };
  const where = await predicate();
  expect(where.sql).toContain('tenant_id');
  expect(where.params).toContain(5);
});
