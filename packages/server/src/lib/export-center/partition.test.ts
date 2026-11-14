import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderPartitionedExport } from './partition';
import { defineExport } from './registry';
import type { ExportRuntimeContext } from './types';
const definition = defineExport({ entity: 'test.partition', moduleName: 'Test', filenamePrefix: 'Test', permissions: { export: 'test' }, columns: [{ key: 'id', header: 'ID' }, { key: 'name', header: 'Name' }], countRows: async () => 5, streamRows: async () => [] });
const ctx: ExportRuntimeContext = { jobId: 1, entity: 'test.partition', moduleName: 'Test', format: 'csv', query: {}, selectedColumns: ['name', 'id'], raw: false, masked: true, sensitive: false, watermark: false, currentUser: { userId: 1, username: 'tester', tenantId: null, roles: [] }, createdByName: null, exportedAt: new Date(), rowLimit: 100 };
it('partitions one complete result and verifies manifest counts, field order, hashes and archive', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'export-partition-test-'));
  try {
    async function* rows() { for (let id = 1; id <= 5; id++) yield { id, name: 'row-' + id }; }
    const result = await renderPartitionedExport(definition, rows(), ctx, folder, 2, 5);
    expect(result.manifest.parts.map(p => p.rowCount)).toEqual([2, 2, 1]);
    expect(result.rowCount).toBe(5);
    for (const part of result.manifest.parts) {
      const bytes = await readFile(join(folder, part.name));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(part.sha256);
      expect(bytes.toString()).toContain('Name,ID');
    }
    expect((await readFile(result.filePath)).subarray(0, 2).toString()).toBe('PK');
    expect(JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')).rowCount).toBe(5);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
describe('partition failure budgets', () => {
  it('rejects a total row budget overflow across partitions without retrying', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'export-partition-test-'));
    try {
      async function* rows() { for (let id = 1; id <= 5; id++) yield { id }; }
      await expect(renderPartitionedExport(definition, rows(), { ...ctx, rowLimit: 3 }, folder, 2, 5)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('总行数超过上限') });
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it('propagates cancellation before consuming later partitions', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'export-partition-test-'));
    let consumed = 0;
    try {
      async function* rows() { for (let id = 1; id <= 10; id++) { consumed++; yield { id }; } }
      await expect(renderPartitionedExport(definition, rows(), { ...ctx, progress: async processed => { if (processed >= 2) throw new Error('cancelled'); } }, folder, 2, 10)).rejects.toThrow('cancelled');
      expect(consumed).toBeLessThanOrEqual(3);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
