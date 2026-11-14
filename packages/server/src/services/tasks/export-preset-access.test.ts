import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, permissions: [] as string[], selected: vi.fn(), insert: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: state.selected, limit: async () => state.rows }) }) }), insert: () => ({ values: state.insert }) } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 7, username: 'test', tenantId: 2, roles: [] }), hasPermission: async (code: string) => state.permissions.includes(code), runWithOperationPermissions: (_permissions: unknown, fn: () => unknown) => fn() }));
vi.mock('../../lib/permissions', () => ({ getUserPermissions: async () => state.permissions, isSuperAdmin: () => false }));
vi.mock('../../lib/export-center/registry', () => ({ listExportDefinitions: () => [{ entity: 'test', permissions: { export: 'test:export' } }] }));
import { listExportPresets, deleteExportPreset, createExportPreset } from './export-presets.service';
beforeEach(() => { state.permissions = ['test:export']; state.selected.mockImplementation(async () => state.rows); state.insert.mockReset(); state.rows = [{ id: 1, name: 'team', entity: 'test', format: 'csv', columns: ['id'], query: { secret: 'private' }, shared: true, cron: '0 9 * * *', createdBy: 8, createdAt: new Date(), nextRunAt: new Date(), lastJobId: 9, lastError: 'private' }]; });
it('shows team fields without exposing another creator query, schedule or management action', async () => {
  const [preset] = await listExportPresets();
  expect(preset).toMatchObject({ columns: ['id'], query: {}, cron: null, lastJobId: null, lastError: null, canManage: false });
  await expect(deleteExportPreset(1)).rejects.toMatchObject({ status: 404 });
});
it('permits team managers to manage but still hides private filter parameters', async () => {
  state.permissions.push('system:export-preset:share');
  const [preset] = await listExportPresets();
  expect(preset).toMatchObject({ canManage: true, query: {} });
});
it('does not list a template when its business export permission was withdrawn', async () => {
  state.permissions = [];
  expect(await listExportPresets()).toEqual([]);
});
it('rejects unauthorized sharing and scheduling before any insert', async () => {
  const input = { name: 'test', entity: 'test', format: 'csv' as const, query: {}, shared: true, cron: null };
  await expect(createExportPreset(input)).rejects.toMatchObject({ status: 403 });
  await expect(createExportPreset({ ...input, shared: false, cron: '* * * * *' })).rejects.toMatchObject({ status: 403 });
  expect(state.insert).not.toHaveBeenCalled();
});
