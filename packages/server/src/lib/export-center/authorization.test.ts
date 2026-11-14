import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../../db/schema';
const state = vi.hoisted(() => ({ permissions: ['test:export'], scope: vi.fn() }));
vi.mock('../data-scope', () => ({ getDataScopeCondition: state.scope }));
vi.mock('../permissions', () => ({ getUserPermissions: async () => state.permissions }));
vi.mock('../tenant', () => ({ getCreateTenantId: (actor: { tenantId: number | null }) => actor.tenantId }));
import { exportRowKey, exportScopeFingerprint, verifyExportRows } from './authorization';
import { defineExport } from './registry';
import type { ExportRuntimeContext } from './types';
const actor = { userId: 1, username: 'test', tenantId: 2, roles: [] };
const definition = defineExport({ entity: 'test', moduleName: 'Test', filenamePrefix: 'Test', columns: [{ key: 'id', header: 'ID' }], permissions: { export: 'test:export' }, countRows: async () => 2, streamRows: async () => [{ id: 1 }, { id: 2 }] });
const context = { query: {}, currentUser: actor, rowLimit: 10 } as ExportRuntimeContext;
beforeEach(() => { state.permissions = ['test:export']; state.scope.mockResolvedValue(undefined); });
it('binds authorization to the exact actor tenant and effective data scope', async () => {
  const initial = await exportScopeFingerprint(definition, actor);
  state.scope.mockResolvedValue(eq(users.id, 1));
  expect(await exportScopeFingerprint(definition, actor)).not.toBe(initial);
  expect(await exportScopeFingerprint(definition, { ...actor, tenantId: 3 })).not.toBe(initial);
});
it('rejects source membership revoked after a file was produced', async () => {
  const keys = [{ id: 1 }, { id: 2 }].map(exportRowKey);
  await expect(verifyExportRows(definition, context, keys)).resolves.toBeUndefined();
  await expect(verifyExportRows({ ...definition, streamRows: async () => [{ id: 1 }] }, context, keys)).rejects.toMatchObject({ status: 403 });
});
it('bounds revalidation and keeps row IDs independent from editable values', async () => {
  expect(exportRowKey({ id: 1, title: 'before' })).toBe(exportRowKey({ id: '1', title: 'after' }));
  await expect(verifyExportRows(definition, { ...context, rowLimit: 1 }, [exportRowKey({ id: 2 })])).rejects.toMatchObject({ status: 403 });
});
