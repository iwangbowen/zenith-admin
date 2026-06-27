/**
 * 类 Excel 打印报表导出定义（接入统一导出中心）。
 * 取数渲染走 renderPrintTemplate（fillPrintGrid），再用 ExcelJS 还原网格/合并/样式/页面设置。
 * 仅 xlsx（含合并单元格与样式，无法用 CSV 表达），renderMode='custom'。
 */
import type ExcelJS from 'exceljs';
import { renderPrintTemplate } from '../../../services/report-print.service';
import { defineExport } from '../registry';
import type { ReportPrintCellStyle } from '@zenith/shared';

interface ReportPrintExportQuery extends Record<string, unknown> {
  templateId: number;
  params?: Record<string, unknown>;
  limit?: number;
}

const PAPER_SIZE: Record<string, number> = { A4: 9, A3: 8, A5: 11, Letter: 1 };

/** CSS 颜色 → ExcelJS ARGB（仅支持 #rgb / #rrggbb / #aarrggbb） */
function toArgb(color?: string): string | undefined {
  if (!color) return undefined;
  let c = color.trim().replace(/^#/, '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  if (c.length === 6) return ('FF' + c).toUpperCase();
  if (c.length === 8) return c.toUpperCase();
  return undefined;
}

function applyStyle(cell: ExcelJS.Cell, s?: ReportPrintCellStyle): void {
  if (!s) return;
  const color = toArgb(s.color);
  if (s.bold || s.italic || s.fontSize || color) {
    cell.font = { bold: s.bold, italic: s.italic, size: s.fontSize, color: color ? { argb: color } : undefined };
  }
  if (s.align || s.valign || s.wrap) {
    cell.alignment = { horizontal: s.align, vertical: s.valign === 'middle' ? 'middle' : s.valign, wrapText: s.wrap };
  }
  const bg = toArgb(s.background);
  if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  if (s.border) {
    const thin = { style: 'thin' as const, color: { argb: 'FFBBBBBB' } };
    cell.border = { top: thin, left: thin, bottom: thin, right: thin };
  }
}

function pickQuery(query: Record<string, unknown>): ReportPrintExportQuery {
  const templateId = Number(query.templateId);
  if (!Number.isInteger(templateId) || templateId <= 0) throw new Error('缺少有效的打印报表 ID');
  const params = query.params && typeof query.params === 'object' && !Array.isArray(query.params)
    ? (query.params as Record<string, unknown>)
    : undefined;
  return { templateId, params, limit: Number(query.limit) || undefined };
}

export const reportPrintExportDefinition = defineExport<ReportPrintExportQuery, Record<string, unknown>>({
  entity: 'report.print',
  moduleName: '打印报表',
  filenamePrefix: '打印报表',
  formats: ['xlsx'],
  renderMode: 'custom',
  permissions: { export: 'report:print:list' },
  execution: { mode: 'sync', syncMaxRows: 5000 },
  columns: [],
  countRows: async () => 1,
  streamRows: () => [],
  renderWorkbook: async (workbook, ctx) => {
    const { templateId, params, limit } = pickQuery(ctx.query);
    const result = await renderPrintTemplate(templateId, { params, limit });
    const grid = result.grid;
    const page = result.pageConfig ?? {};

    const sheet = workbook.addWorksheet(result.name?.slice(0, 28) || '打印报表', {
      pageSetup: {
        paperSize: PAPER_SIZE[page.paper ?? 'A4'] ?? 9,
        orientation: page.orientation ?? 'portrait',
        fitToPage: true,
        margins: page.margin
          ? { top: page.margin.top / 25.4, bottom: page.margin.bottom / 25.4, left: page.margin.left / 25.4, right: page.margin.right / 25.4, header: 0.3, footer: 0.3 }
          : undefined,
      },
      headerFooter: (page.header || page.footer)
        ? { oddHeader: page.header ? `&C${page.header}` : undefined, oddFooter: page.footer ? `&C${page.footer}` : undefined }
        : undefined,
    });

    // 列宽（px → Excel 字符宽度近似 px/7）
    if (grid.colWidths?.length) {
      grid.colWidths.forEach((w, i) => { if (w > 0) sheet.getColumn(i + 1).width = Math.max(6, Math.round(w / 7)); });
    }
    // 行高（px → pt 近似 px*0.75）
    if (grid.rowHeights?.length) {
      grid.rowHeights.forEach((h, i) => { if (h > 0) sheet.getRow(i + 1).height = Math.round(h * 0.75); });
    }
    // 单元格值 + 样式
    for (const c of grid.cells ?? []) {
      const cell = sheet.getCell(c.row + 1, c.col + 1);
      cell.value = (c.v ?? null) as ExcelJS.CellValue;
      applyStyle(cell, c.s);
    }
    // 合并
    for (const m of grid.merges ?? []) {
      if (m.rowSpan <= 1 && m.colSpan <= 1) continue;
      try { sheet.mergeCells(m.row + 1, m.col + 1, m.row + m.rowSpan, m.col + m.colSpan); } catch { /* 越界合并忽略 */ }
    }
  },
});
