import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
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
  it('ordinary CSV uses the same literal formula protection', async () => {
    const text = (await renderExportCsv(definition, [{ name: '=1+1' }], { ...context, format: 'csv' })).toString();
    expect(text).toContain("'=1+1");
  });
  it('masks numeric sensitive identifiers', () => {
    expect(formatExportCell({ key: 'id', header: '编号', sensitive: true }, { id: 123456 }, context)).not.toBe(123456);
    expect(formatExportCell({ key: 'id', header: '编号', sensitive: true }, { id: 123456 }, context)).not.toBe('123456');
  });
});

