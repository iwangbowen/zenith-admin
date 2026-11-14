import { describe, expect, it, vi } from 'vitest';
vi.mock('../../db', () => ({ db: {} }));
vi.mock('../context', () => ({ currentUser: () => ({ userId: 1, username: 'test', roles: [], tenantId: null }) }));
vi.mock('../permissions', () => ({ getUserPermissions: async () => ['test:export'], isSuperAdmin: () => false }));
vi.mock('../../services/platform/data-mask.service', () => ({ getExportMaskRuleMap: async () => new Map() }));
vi.mock('../settings', () => ({ getSettings: async () => ({ maxRows: 500000, syncMaxRows: 5000, maxFileMb: 128, maxColumns: 256, dailyJobsPerUser: 100, schedulingEnabled: true }) }));
import { registerExport, defineExport } from './registry';
import { previewExport } from './preview';
import { createExportJobSchema } from '@zenith/shared/tasks';
registerExport(defineExport({ entity: 'test.preview', moduleName: 'Test', filenamePrefix: 'Test', permissions: { export: 'test:export' }, columns: [{ key: 'id', header: 'ID' }, { key: 'phone', header: '手机', sensitive: 'phone' }], countRows: async () => 2, streamRows: async () => [{ id: 1, phone: '13812345678' }, { id: 2, phone: '13899998888' }] }));
describe('export configuration preview', () => {
  it('keeps preview samples masked even when raw export is authorized and requested', async () => {
    registerExport(defineExport({ entity: 'test.preview.raw', moduleName: 'Test', filenamePrefix: 'Test', permissions: { export: 'test:export', exportRaw: 'test:export' }, columns: [{ key: 'phone', header: '手机', sensitive: 'phone' }], countRows: async () => 1, streamRows: async () => [{ phone: '13812345678' }] }));
    const result = await previewExport(createExportJobSchema.parse({ entity: 'test.preview.raw', raw: true }));
    expect(result.canExportRaw).toBe(true);
    expect(result.sample).toHaveLength(1);
    expect(JSON.stringify(result.sample)).not.toContain('13812345678');
  });
  it('masks samples and exposes permitted capabilities', async () => {
    const result = await previewExport(createExportJobSchema.parse({ entity: 'test.preview' }));
    expect(result.estimatedRows).toBe(2);
    expect(JSON.stringify(result.sample)).not.toContain('13812345678');
    expect(result.canExportRaw).toBe(false);
    expect(result.supportsRowScope).toBe(true);
  });
  it('restricts page samples to the supplied IDs and chosen fields', async () => {
    const result = await previewExport(createExportJobSchema.parse({ entity: 'test.preview', scope: 'selected', rowIds: [2], columns: ['id'] }));
    expect(result.sample).toEqual([{ ID: 2 }]);
    expect(result.estimatedRows).toBe(1);
  });
  it('rejects raw and unknown columns', async () => {
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview', raw: true }))).rejects.toMatchObject({ status: 403 });
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview', columns: ['unknown'] }))).rejects.toMatchObject({ status: 400 });
  });
});

