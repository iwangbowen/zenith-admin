import { describe, expect, it, vi } from 'vitest';
vi.mock('../../db', () => ({ db: {} }));
vi.mock('../context', () => ({ currentUser: () => ({ userId: 1, username: 'test', roles: [], tenantId: null }), runWithOperationPermissions: (_permissions: unknown, fn: () => unknown) => fn() }));
vi.mock('../permissions', () => ({ getUserPermissions: async () => ['test:export'], isSuperAdmin: () => false }));
vi.mock('../../services/platform/data-mask.service', () => ({ getExportMaskRuleMap: async () => new Map() }));
vi.mock('../settings', () => ({ getSettings: async () => ({ maxRows: 500000, syncMaxRows: 5000, maxFileMb: 128, maxColumns: 256, dailyJobsPerUser: 100, schedulingEnabled: true }) }));
import { registerExport, defineExport } from './registry';
import { previewExport } from './preview';
import { createExportJobSchema } from '@zenith/shared/tasks';
import { prepareExport } from './prepare';
import * as z from 'zod';
registerExport(defineExport({ entity: 'test.preview', moduleName: 'Test', filenamePrefix: 'Test', permissions: { export: 'test:export' }, columns: [{ key: 'id', header: 'ID' }, { key: 'phone', header: '手机', sensitive: 'phone' }], countRows: async () => 2, streamRows: async () => [{ id: 1, phone: '13812345678' }, { id: 2, phone: '13899998888' }] }));
describe('export configuration preview', () => {
  it('reports invalid domain query parameters as a client error instead of 500', async () => {
    registerExport(defineExport({ entity: 'test.preview.invalid-query', moduleName: 'Test', filenamePrefix: 'Test', columns: [], permissions: { export: 'test:export' }, prepareQuery: async query => z.object({ contextId: z.int().positive() }).parse(query), countRows: async () => 0, streamRows: async () => [] }));
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview.invalid-query', query: { contextId: 'bad' } }))).rejects.toMatchObject({ status: 400 });
  });
  it('freezes default fields and normalizes duplicate row identities before admission', async () => {
    const result = await prepareExport(createExportJobSchema.parse({ entity: 'test.preview', scope: 'selected', rowIds: [2, '2'] }), { userId: 1, username: 'test', tenantId: null, roles: [] });
    expect(result.selectedColumns).toEqual(['id', 'phone']);
    expect(result.rowIds).toEqual(['2']);
  });
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
  it('deduplicates selected IDs, rejects missing rows and validates partition capability', async () => {
    const result = await previewExport(createExportJobSchema.parse({ entity: 'test.preview', scope: 'selected', rowIds: [2, '2'], columns: ['id'] }));
    expect(result.estimatedRows).toBe(1);
    expect(result.sample).toEqual([{ ID: 2 }]);
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview', scope: 'selected', rowIds: [9] }))).rejects.toMatchObject({ status: 400 });
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview', columns: ['id', 'id'] }))).rejects.toMatchObject({ status: 400 });
  });
  it('rejects unsupported custom selections and excessive partitions before creating a job', async () => {
    registerExport(defineExport({ entity: 'test.preview.custom', moduleName: 'Test', filenamePrefix: 'Test', renderMode: 'custom', columns: [{ key: 'id', header: 'ID' }], permissions: { export: 'test:export' }, countRows: async () => 1, streamRows: async () => [] }));
    const custom = await previewExport(createExportJobSchema.parse({ entity: 'test.preview.custom' }));
    expect(custom.supportsColumns).toBe(false);
    expect(custom.supportsPartition).toBe(false);
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview.custom', columns: ['id'] }))).rejects.toMatchObject({ status: 400 });
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview.custom', splitRows: 1 }))).rejects.toMatchObject({ status: 400 });
    registerExport(defineExport({ entity: 'test.preview.large', moduleName: 'Test', filenamePrefix: 'Test', columns: [{ key: 'id', header: 'ID' }], permissions: { export: 'test:export' }, countRows: async () => 201, streamRows: async () => [] }));
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview.large', splitRows: 1 }))).rejects.toMatchObject({ status: 400 });
  });
  it('rejects layout and an overflow count consistently during preview', async () => {
    registerExport(defineExport({ entity: 'test.preview.overflow', moduleName: 'Test', filenamePrefix: 'Test', columns: [], permissions: { export: 'test:export' }, execution: { maxRows: 1 }, countRows: async () => 2, streamRows: async () => [] }));
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview.overflow' }))).rejects.toMatchObject({ status: 400 });
    registerExport(defineExport({ entity: 'test.preview.layout', moduleName: 'Test', filenamePrefix: 'Test', renderMode: 'layout', columns: [], permissions: { export: 'test:export' }, countRows: async () => 0, streamRows: async () => [] }));
    await expect(previewExport(createExportJobSchema.parse({ entity: 'test.preview.layout' }))).rejects.toMatchObject({ status: 400 });
  });
});

