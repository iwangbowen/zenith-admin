import { describe, expect, it, vi } from 'vitest';
vi.mock('../../db', () => ({ db: {} }));
vi.mock('../context', () => ({ currentUser: () => ({ userId: 1, username: 'test', roles: [], tenantId: null }) }));
vi.mock('../permissions', () => ({ getUserPermissions: async () => ['test:export'], isSuperAdmin: () => false }));
vi.mock('../../services/platform/data-mask.service', () => ({ getExportMaskRuleMap: async () => new Map() }));
import { registerExport, defineExport } from './registry';
import { previewExport } from './preview';
import { createExportJobSchema } from '@zenith/shared/tasks';
registerExport(defineExport({ entity: 'test.preview', moduleName: 'Test', filenamePrefix: 'Test', permissions: { export: 'test:export' }, columns: [{ key: 'id', header: 'ID' }, { key: 'phone', header: '手机', sensitive: 'phone' }], countRows: async () => 2, streamRows: async () => [{ id: 1, phone: '13812345678' }, { id: 2, phone: '13899998888' }] }));
describe('export configuration preview', () => {
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

