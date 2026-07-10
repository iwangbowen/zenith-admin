import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { renderPrintContent } from '@zenith/shared';
import { renderPrintExportFile, renderPrintResultToWorkbook } from './report-print-export';

describe('report-print-export', () => {
  const result = renderPrintContent(
    '导出测试',
    {
      sheets: [
        {
          id: 'sheet-01',
          name: '明细',
          grid: {
            rows: 3,
            cols: 2,
            cells: [
              { row: 0, col: 0, v: '名称', s: { bold: true, border: true } },
              { row: 0, col: 1, v: '金额', s: { bold: true, border: true } },
              { row: 1, col: 0, v: '${name}', kind: 'text', s: { border: { left: { color: '#ff0000' }, right: { color: '#00ff00' } } } },
              { row: 1, col: 1, v: '${amount}', numFmt: '#,##0.00', formula: '=1+1' },
              { row: 2, col: 0, v: '二维码' },
              { row: 2, col: 1, v: '${QRCODE(name)}' },
            ],
            merges: [{ row: 2, col: 0, rowSpan: 1, colSpan: 2 }],
          },
          pageConfig: { repeatHeaderRows: { start: 0, end: 0 }, rowsPerPage: 1, footer: '第 {page}/{pages} 页' },
        },
        {
          id: 'sheet-02',
          name: '条码',
          grid: {
            rows: 1,
            cols: 1,
            cells: [{ row: 0, col: 0, v: '${CODE128(code)}' }],
          },
        },
      ],
    },
    [{ name: '测试', amount: 12.5, code: 'ABC-123' }],
  );

  it('生成多 sheet workbook 并保留公式/格式', async () => {
    const workbook = new ExcelJS.Workbook();
    const rowCount = await renderPrintResultToWorkbook(workbook, result);
    expect(rowCount).toBe(result.sheets.reduce((sum, sheet) => sum + sheet.grid.rows, 0));
    expect(workbook.worksheets).toHaveLength(2);
    const detailSheet = workbook.getWorksheet('明细');
    expect(detailSheet).toBeTruthy();
    const valueCell = detailSheet!.getCell(2, 2);
    expect(valueCell.numFmt).toBe('#,##0.00');
    expect(valueCell.value).toMatchObject({ formula: '1+1' });
    expect(detailSheet!.pageSetup.printTitlesRow).toBe('1:1');
  });

  it('能输出真实 xlsx 与 pdf 文件', async () => {
    const xlsx = await renderPrintExportFile(result, 'xlsx');
    const pdf = await renderPrintExportFile(result, 'pdf');
    expect(xlsx.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(xlsx.rowCount).toBeGreaterThan(0);
    expect(Buffer.from(xlsx.buffer).byteLength).toBeGreaterThan(1000);
    expect(pdf.mimeType).toBe('application/pdf');
    expect(Buffer.from(pdf.buffer).subarray(0, 4).toString('utf8')).toBe('%PDF');
  });
});
