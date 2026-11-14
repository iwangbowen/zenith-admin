import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { formatExportCell } from './formatter';
import { renderExportCsv, renderExportWorkbook } from './writer';
import { defineExport } from './registry';
import type { ExportRuntimeContext } from './types';
const definition = defineExport({ entity: 'test.safe', moduleName: '安全导出', filenamePrefix: '安全导出', permissions: { export: 'test' }, columns: [{ key: 'name', header: '名称' }], countRows: async () => 1, streamRows: async () => [] });
const context: ExportRuntimeContext = { jobId: 1, entity: 'test.safe', moduleName: '安全导出', format: 'xlsx', query: { phone: '13812345678', token: 'secret-token-value' }, selectedColumns: null, raw: false, masked: true, sensitive: true, watermark: true, currentUser: { userId: 1, username: 'tester', roles: [], tenantId: null }, createdByName: null, exportedAt: new Date() };
describe('export security boundaries', () => {
  it('does not embed raw filters anywhere in workbook cells', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await renderExportWorkbook(definition, [{ name: 'safe' }], context) as never);
    const cells: unknown[] = [];
    book.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => cells.push(cell.value))));
    expect(JSON.stringify(cells)).not.toContain('13812345678');
    expect(JSON.stringify(cells)).not.toContain('secret-token-value');
  });
  it('does not leak sensitive filter tokens into any workbook ZIP member', async () => {
    const buffer = await renderExportWorkbook(definition, [{ name: 'safe' }], { ...context, query: { ...context.query, email: 'secret-email@example.invalid', idCard: '110101199001011234', params: { accessToken: 'nested-secret-token' } } });
    const archive = await JSZip.loadAsync(buffer);
    for (const entry of Object.values(archive.files)) {
      if (entry.dir) continue;
      const text = await entry.async('string');
      for (const secret of ['13812345678', 'secret-token-value', 'secret-email@example.invalid', '110101199001011234', 'nested-secret-token']) expect(text).not.toContain(secret);
    }
  });
  it('ordinary CSV uses the same literal formula protection', async () => {
    const text = (await renderExportCsv(definition, [{ name: '=1+1' }], { ...context, format: 'csv' })).toString();
    expect(text).toContain("'=1+1");
  });
  it('keeps untrusted object values literal instead of interpreting Excel formula or hyperlink objects', async () => {
    const malicious = [{ name: { formula: '1+1', result: 2 } }, { name: { text: 'click', hyperlink: 'https://untrusted.invalid' } }];
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await renderExportWorkbook(definition, malicious, { ...context, watermark: false }) as never);
    const values: unknown[] = [];
    book.worksheets[0].eachRow(row => { if (row.number > 1) values.push(row.getCell(1).value); });
    expect(values).toEqual(malicious.map(row => JSON.stringify(row.name)));
  });
  it('masks numeric sensitive identifiers', () => {
    expect(formatExportCell({ key: 'id', header: '编号', sensitive: true }, { id: 123456 }, context)).not.toBe(123456);
    expect(formatExportCell({ key: 'id', header: '编号', sensitive: true }, { id: 123456 }, context)).not.toBe('123456');
  });
});
