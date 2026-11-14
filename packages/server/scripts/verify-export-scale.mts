import '@hono/zod-openapi';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineExport } from '../src/lib/export-center/registry';
import { renderExportToPath } from '../src/lib/export-center/writer';
import type { ExportRuntimeContext } from '../src/lib/export-center/types';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
const output = resolve('../../output/export-special-scale.json');
const results = [];
for (const format of ['csv', 'xlsx'] as const) {
  const folder = await mkdtemp(join(tmpdir(), 'zenith-export-scale-'));
  const columns = Array.from({ length: 32 }, (_, index) => ({ key: 'c' + index, header: '字段' + index }));
  const definition = defineExport({ entity: 'qa.scale', moduleName: 'QA', filenamePrefix: 'QA', columns, permissions: { export: 'qa' }, countRows: async () => 50000, streamRows: async () => [] });
  let consumed = 0; let peakRss = process.memoryUsage().rss; let progressCalls = 0;
  const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable();
  const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
  const context: ExportRuntimeContext = { jobId: 1, entity: 'qa.scale', moduleName: 'QA', format, query: {}, selectedColumns: null, raw: false, masked: true, sensitive: false, watermark: true, currentUser: { userId: 1, username: 'qa', tenantId: null, roles: [] }, createdByName: 'QA', exportedAt: new Date(), rowLimit: 50000, byteLimit: 128 * 1024 * 1024, progress: async () => { progressCalls++; } };
  async function* rows() { for (let index = 0; index < 50000; index++) { consumed++; yield Object.fromEntries(columns.map((column, i) => [column.key, i === 0 ? index : '中文长文本-' + index + '-' + 'x'.repeat(i === 31 ? 1024 : 12)])); } }
  const start = performance.now();
  try {
    const path = join(folder, 'report.' + format);
    const written = await renderExportToPath(definition, rows(), context, path, 50000);
    if (written !== 50000 || consumed !== 50000) throw new Error('Incomplete result');
    let verified = 0;
    if (format === 'csv') {
      const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
      for await (const line of lines) { if (verified > 0 && !line.startsWith(String(verified - 1) + ',')) throw new Error('CSV row order mismatch'); verified++; }
      verified--;
    } else {
      const ExcelJS = createRequire(import.meta.url)('exceljs') as typeof import('exceljs');
      const workbook = new ExcelJS.stream.xlsx.WorkbookReader(path, { worksheets: 'emit', sharedStrings: 'cache', styles: 'ignore' });
      for await (const sheet of workbook) { if (sheet.name === '导出信息') continue; for await (const row of sheet) { if (typeof row.getCell(1).value === 'number') { if (row.getCell(1).value !== verified) throw new Error('XLSX row order mismatch'); verified++; } } }
    }
    if (verified !== 50000) throw new Error('Readback lost rows: ' + verified);
    results.push({ format, written, consumed, verified, bytes: (await stat(path)).size, durationMs: Math.round(performance.now() - start), peakRssMb: Math.round(peakRss / 1048576), eventLoopMaxMs: Math.round(histogram.max / 1e6), progressCalls });
    await writeFile(output, JSON.stringify(results, null, 2));
    process.stdout.write(JSON.stringify(results.at(-1)) + '\n');
  } finally { clearInterval(timer); histogram.disable(); await rm(folder, { recursive: true, force: true }); }
}
