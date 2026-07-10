import { describe, expect, it } from 'vitest';
import { printContentToUniver, univerToPrintContent } from './print-univer';

describe('print-univer', () => {
  it('支持多 sheet 与样式/公式/图片 roundtrip', () => {
    const content = {
      sheets: [
        {
          id: 'sheet-01',
          name: '主表',
          grid: {
            rows: 2,
            cols: 2,
            colWidths: [120, 180],
            rowHeights: [30, 40],
            cells: [
              {
                row: 0,
                col: 0,
                v: '标题',
                s: {
                  fontFamily: 'Microsoft YaHei',
                  fontSize: 14,
                  bold: true,
                  color: '#111111',
                  background: '#eeeeee',
                  align: 'center' as const,
                  valign: 'middle' as const,
                  wrap: true,
                  border: { top: { color: '#ff0000' }, right: { color: '#00ff00' } },
                },
              },
              {
                row: 1,
                col: 0,
                v: '12.3',
                formula: '=SUM(1,2)',
                numFmt: '#,##0.00',
                kind: 'formula' as const,
              },
              {
                row: 1,
                col: 1,
                v: '二维码',
                kind: 'qrcode' as const,
                image: { src: 'data:image/png;base64,AAAA', width: 32, height: 32 },
              },
            ],
            merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
          },
          pageConfig: { paper: 'A4' as const, repeatHeaderRows: { start: 0, end: 0 } },
        },
        {
          id: 'sheet-02',
          name: '附表',
          grid: { rows: 1, cols: 1, cells: [{ row: 0, col: 0, v: '${CODE128(code)}', kind: 'barcode' as const }] },
        },
      ],
    };

    const workbook = printContentToUniver(content, '测试模板');
    const roundtrip = univerToPrintContent(workbook);

    expect(roundtrip.sheets).toHaveLength(2);
    expect(roundtrip.sheets?.[0]?.pageConfig?.repeatHeaderRows).toEqual({ start: 0, end: 0 });
    expect(roundtrip.sheets?.[0]?.grid.colWidths?.[1]).toBe(180);
    expect(roundtrip.sheets?.[0]?.grid.rowHeights?.[1]).toBe(40);
    expect(roundtrip.sheets?.[0]?.grid.cells.find((cell) => cell.row === 1 && cell.col === 0)?.formula).toBe('=SUM(1,2)');
    expect(roundtrip.sheets?.[0]?.grid.cells.find((cell) => cell.row === 1 && cell.col === 0)?.numFmt).toBe('#,##0.00');
    expect(roundtrip.sheets?.[0]?.grid.cells.find((cell) => cell.row === 1 && cell.col === 1)?.kind).toBe('qrcode');
    expect(roundtrip.sheets?.[1]?.grid.cells[0]?.kind).toBe('barcode');
  });
});
