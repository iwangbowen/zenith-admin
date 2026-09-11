import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { renderPrintContent } from '@zenith/shared/report';
import type { ReportPrintRenderPage, ReportPrintRenderResult } from '@zenith/shared/report';

// 字形覆盖检查的日志出口；字体固定为仓库内的全量 Noto Sans SC 但标记为「子集」来源，验证提示文案按来源切换
vi.mock('./logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./pdf-font', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdf-font')>();
  return { ...actual, resolvePdfFont: vi.fn(() => ({ path: actual.BUNDLED_PDF_FONT_FULL_PATH, source: 'bundled-subset' as const })) };
});

import logger from './logger';
import { findUncoveredChars, renderPrintResultToDocx, renderPrintResultToPdf, renderPrintResultToWorkbook } from './report-print-export';

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

  it('生成真实 DOCX ZIP，包含分节、横向纸张、合并单元格与图片', async () => {
    const docxResult = renderPrintContent('Word 测试', {
      grid: {
        rows: 3,
        cols: 3,
        colWidths: [90, 90, 100],
        rowHeights: [30, 28, 28],
        cells: [
          { row: 0, col: 0, v: '合并标题', s: { bold: true, align: 'center', background: '#eeeeee', border: true } },
          { row: 0, col: 2, v: '图片', image: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } },
          { row: 1, col: 0, v: '纵向合并' },
          { row: 1, col: 1, v: 'A' },
          { row: 1, col: 2, v: 'B' },
          { row: 2, col: 1, v: 'C' },
          { row: 2, col: 2, v: 'D' },
        ],
        merges: [
          { row: 0, col: 0, rowSpan: 1, colSpan: 2 },
          { row: 1, col: 0, rowSpan: 2, colSpan: 1 },
        ],
      },
    }, [], {}, {
      paper: 'A4',
      orientation: 'landscape',
      margin: { top: 10, right: 11, bottom: 12, left: 13 },
      repeatHeaderRows: { start: 0, end: 0 },
    });

    const buffer = await renderPrintResultToDocx(docxResult);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const archive = await JSZip.loadAsync(buffer);
    const documentXml = await archive.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('<w:sectPr');
    expect(documentXml).toContain('w:orient="landscape"');
    expect(documentXml).toContain('w:w="16838"');
    expect(documentXml).toContain('w:h="11906"');
    expect(documentXml).toContain('<w:gridSpan w:val="2"');
    expect(documentXml).toContain('<w:vMerge w:val="restart"');
    expect(Object.keys(archive.files).some((name) => name.startsWith('word/media/'))).toBe(true);
  });

  it('DOCX 图片总量超限时明确拒绝', async () => {
    const largePng = Buffer.alloc(1_800_000);
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(largePng);
    const src = `data:image/png;base64,${largePng.toString('base64')}`;
    const page = (pageNumber: number): ReportPrintRenderPage => ({
      sheetId: 'images',
      sheetName: '图片',
      pageNumber,
      totalPages: 6,
      grid: {
        rows: 1,
        cols: 1,
        cells: [{ row: 0, col: 0, kind: 'image', image: { src } }],
      },
      pageConfig: {},
    });
    const oversized = {
      ...result,
      pages: Array.from({ length: 6 }, (_, index) => page(index + 1)),
    } satisfies ReportPrintRenderResult;

    await expect(renderPrintResultToDocx(oversized)).rejects.toThrow('图片总大小超过');
  });

  // 60s 超时：发布流程四路并行下 pdfkit 惰性加载与转译资源被抢，默认 5s 会被压穿
  // （单独跑 ~1s 即过；参照 app.contract/app.routes 的放宽先例）
  it('PDF 对超宽合并单元格和长文本进行页面内裁剪', async () => {
    const pdfResult = renderPrintContent('PDF overflow', {
      grid: {
        rows: 1,
        cols: 2,
        colWidths: [1200, 1200],
        rowHeights: [28],
        cells: [{ row: 0, col: 0, v: 'very long text '.repeat(100), s: { wrap: true, border: true } }],
        merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
      },
    }, []);
    const buffer = await renderPrintResultToPdf(pdfResult);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  }, 60_000);

  describe('字体字形覆盖检查', () => {
    it('findUncoveredChars 去重、跳过空白与控制字符、按上限截断', () => {
      const hasGlyph = (cp: number) => cp < 0x80 || cp === '中'.codePointAt(0);
      expect(findUncoveredChars(hasGlyph, ['abc 中\n\t', ''])).toEqual([]);
      expect(findUncoveredChars(hasGlyph, ['张三 龘', '龘龘 玥', 'x😀'])).toEqual(['张', '三', '龘', '玥', '😀']);
      expect(findUncoveredChars(hasGlyph, ['张三龘玥'], 2)).toEqual(['张', '三']);
    });

    // 60s 超时：与上方 PDF 用例同一原因（pdfkit / fontkit 惰性加载在四路并行下被抢）
    it('导出文本含字体没有字形的字符时记 warn 并列出缺字与切换全量字体的提示', async () => {
      const warn = vi.mocked(logger.warn);
      warn.mockClear();
      const ok = renderPrintContent('覆盖', { grid: { rows: 1, cols: 1, cells: [{ row: 0, col: 0, v: '审批单：张三（财务部）￥1,234.56 ①' }] } }, []);
      await renderPrintResultToPdf(ok, { watermark: '打印人 时间' });
      expect(warn).not.toHaveBeenCalled();

      // 泰文与 emoji 不在 Noto Sans SC 内；二维码单元格的值不参与文本绘制，不应计入
      const missing = renderPrintContent('覆盖', {
        grid: {
          rows: 1,
          cols: 2,
          cells: [
            { row: 0, col: 0, v: '备注：ก 😀' },
            { row: 0, col: 1, v: 'ยยย', kind: 'qrcode' },
          ],
        },
      }, []);
      await renderPrintResultToPdf(missing);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain('ก 😀');
      expect(message).not.toContain('ย');
      expect(message).toContain('PDF_FONT=full');
    }, 60_000);
  });
});
