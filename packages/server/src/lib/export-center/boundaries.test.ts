import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderExportToPath } from './writer';
import { defineExport } from './registry';
import type { ExportRuntimeContext } from './types';
const definition = defineExport({ entity: 'test.boundary', moduleName: 'Test', filenamePrefix: 'Test', columns: [{ key: 'id', header: 'ID' }], permissions: { export: 'test' }, countRows: async () => 0, streamRows: async () => [] });
it.each([49999, 50000, 50001, 60000])('enforces exact 50000-row boundary for %s source rows without clipping', async count => {
  const folder = await mkdtemp(join(tmpdir(), 'export-boundary-'));
  const ctx = { format: 'csv', query: {}, selectedColumns: null, rowLimit: 50000, raw: false, masked: true } as ExportRuntimeContext;
  let consumed = 0;
  async function* rows() { for (let id = 1; id <= count; id++) { consumed++; yield { id }; } }
  try {
    const result = renderExportToPath(definition, rows(), ctx, join(folder, 'report.csv'), count);
    if (count <= 50000) expect(await result).toBe(count);
    else { await expect(result).rejects.toThrow('超过上限'); expect(consumed).toBe(50001); }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
