import fs from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import { config } from '../config';
import type { ReportPrintBorder, ReportPrintCell, ReportPrintCellStyle, ReportPrintGrid, ReportPrintMerge, ReportPrintPageConfig, ReportPrintRenderPage, ReportPrintRenderResult } from '@zenith/shared';

const PAPER_SIZE: Record<NonNullable<ReportPrintPageConfig['paper']>, number> = { A4: 9, A3: 8, A5: 11, Letter: 1 };
const PDF_PAPER_SIZE: Record<NonNullable<ReportPrintPageConfig['paper']>, string> = { A4: 'A4', A3: 'A3', A5: 'A5', Letter: 'LETTER' };
const PDF_FONT_CANDIDATES = [
  ...(config.report.pdfFontPath ? [config.report.pdfFontPath] : []),
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\simsun.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
];
const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;
type RenderedGraphic = { buffer: Buffer; extension: 'png' | 'jpeg' };

function toArgb(color?: string): string | undefined {
  if (!color) return undefined;
  let normalized = color.trim().replace(/^#/, '');
  if (normalized.length === 3) normalized = normalized.split('').map((item) => item + item).join('');
  if (normalized.length === 6) return `FF${normalized}`.toUpperCase();
  if (normalized.length === 8) return normalized.toUpperCase();
  return undefined;
}

function pxToExcelWidth(px: number) {
  return Math.max(6, Math.round(px / 7));
}

function pxToPt(px: number) {
  return Math.round(px * 0.75 * 100) / 100;
}

function mmToPt(mm: number) {
  return (mm * 72) / 25.4;
}

function normalizeBorder(border: boolean | ReportPrintBorder | undefined): ReportPrintBorder | null {
  if (!border) return null;
  if (border === true) {
    return {
      top: { style: 'thin', color: '#111827' },
      right: { style: 'thin', color: '#111827' },
      bottom: { style: 'thin', color: '#111827' },
      left: { style: 'thin', color: '#111827' },
    };
  }
  return border;
}

function applyStyle(cell: ExcelJS.Cell, style?: ReportPrintCellStyle, numFmt?: string): void {
  if (!style && !numFmt) return;
  const color = toArgb(style?.color);
  if (style?.bold || style?.italic || style?.fontFamily || style?.fontSize || color) {
    cell.font = {
      name: style?.fontFamily,
      bold: style?.bold,
      italic: style?.italic,
      size: style?.fontSize,
      color: color ? { argb: color } : undefined,
    };
  }
  if (style?.align || style?.valign || style?.wrap) {
    cell.alignment = {
      horizontal: style.align,
      vertical: style.valign === 'middle' ? 'middle' : style.valign,
      wrapText: style.wrap,
    };
  }
  const bg = toArgb(style?.background);
  if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  const border = normalizeBorder(style?.border);
  if (border) {
    const side = (value: { color?: string } | undefined) => value ? { style: 'thin' as const, color: { argb: toArgb(value.color) ?? 'FF111827' } } : undefined;
    cell.border = {
      top: side(border.top),
      right: side(border.right),
      bottom: side(border.bottom),
      left: side(border.left),
    };
  }
  if (numFmt) cell.numFmt = numFmt;
}

function isCoveredByMerge(row: number, col: number, merges: ReportPrintMerge[]) {
  return merges.some((merge) => row >= merge.row && row < merge.row + merge.rowSpan && col >= merge.col && col < merge.col + merge.colSpan && !(row === merge.row && col === merge.col));
}

function findMerge(row: number, col: number, merges: ReportPrintMerge[]) {
  return merges.find((merge) => merge.row === row && merge.col === col);
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; extension: 'png' | 'jpeg' } | null {
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  if (match[2].length > Math.ceil(MAX_EMBEDDED_IMAGE_BYTES * 4 / 3)) {
    throw new Error('打印图片解码后不能超过 2MB');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_EMBEDDED_IMAGE_BYTES) throw new Error('打印图片解码后不能超过 2MB');
  return {
    buffer,
    extension: match[1].toLowerCase() === 'png' ? 'png' : 'jpeg',
  };
}

async function renderGraphic(cell: ReportPrintCell, cache: Map<string, RenderedGraphic>): Promise<RenderedGraphic | null> {
  if (cell.kind === 'qrcode') {
    const text = String(cell.v ?? '').trim();
    if (!text) return null;
    const key = `qrcode:${text}`;
    if (!cache.has(key)) cache.set(key, { buffer: await QRCode.toBuffer(text, { margin: 0, width: 256 }), extension: 'png' });
    return cache.get(key) ?? null;
  }
  if (cell.kind === 'barcode') {
    const text = String(cell.v ?? '').trim();
    if (!text) return null;
    const key = `barcode:${text}`;
    if (!cache.has(key)) {
      cache.set(key, {
        buffer: await bwipjs.toBuffer({
          bcid: 'code128',
          text,
          scale: 3,
          height: 12,
          includetext: false,
          backgroundcolor: 'FFFFFF',
        }),
        extension: 'png',
      });
    }
    return cache.get(key) ?? null;
  }
  if (cell.image?.src) {
    const parsed = parseDataUrl(cell.image.src);
    return parsed;
  }
  return null;
}

function sheetPageSetup(config: ReportPrintPageConfig): Partial<ExcelJS.PageSetup> {
  return {
    paperSize: PAPER_SIZE[config.paper ?? 'A4'] ?? 9,
    orientation: config.orientation ?? 'portrait',
    fitToPage: true,
    margins: config.margin
      ? {
          top: config.margin.top / 25.4,
          bottom: config.margin.bottom / 25.4,
          left: config.margin.left / 25.4,
          right: config.margin.right / 25.4,
          header: 0.3,
          footer: 0.3,
        }
      : undefined,
    printTitlesRow: config.repeatHeaderRows ? `${config.repeatHeaderRows.start + 1}:${config.repeatHeaderRows.end + 1}` : undefined,
  };
}

function addExcelPageBreaks(sheet: ExcelJS.Worksheet, grid: ReportPrintGrid, config: ReportPrintPageConfig) {
  const headerRows = config.repeatHeaderRows ? config.repeatHeaderRows.end - config.repeatHeaderRows.start + 1 : 0;
  if (config.rowsPerPage && config.rowsPerPage > 0) {
    for (let row = headerRows + config.rowsPerPage; row < grid.rows; row += config.rowsPerPage) {
      sheet.getRow(row + 1).addPageBreak();
    }
  }
  for (const breakRow of config.pageBreaks ?? []) {
    const rowNumber = headerRows + breakRow;
    if (rowNumber > 0 && rowNumber < grid.rows) sheet.getRow(rowNumber + 1).addPageBreak();
  }
}

export async function renderPrintResultToWorkbook(workbook: ExcelJS.Workbook, result: ReportPrintRenderResult): Promise<number> {
  const imageCache = new Map<string, RenderedGraphic>();
  let totalRows = 0;
  for (const sheetResult of result.sheets) {
    totalRows += sheetResult.grid.rows;
    const worksheet = workbook.addWorksheet(sheetResult.name.slice(0, 28) || '打印报表', {
      pageSetup: sheetPageSetup(sheetResult.pageConfig),
      headerFooter: (sheetResult.pageConfig.header || sheetResult.pageConfig.footer)
        ? {
            oddHeader: sheetResult.pageConfig.header ? `&C${sheetResult.pageConfig.header}` : undefined,
            oddFooter: sheetResult.pageConfig.footer ? `&C${sheetResult.pageConfig.footer}` : undefined,
          }
        : undefined,
    });
    if (sheetResult.grid.colWidths?.length) {
      sheetResult.grid.colWidths.forEach((width, index) => {
        if (width > 0) worksheet.getColumn(index + 1).width = pxToExcelWidth(width);
      });
    }
    if (sheetResult.grid.rowHeights?.length) {
      sheetResult.grid.rowHeights.forEach((height, index) => {
        if (height > 0) worksheet.getRow(index + 1).height = pxToPt(height);
      });
    }

    const graphics: Array<{ cell: ReportPrintCell; graphic: RenderedGraphic }> = [];
    for (const cellDef of sheetResult.grid.cells ?? []) {
      const cell = worksheet.getCell(cellDef.row + 1, cellDef.col + 1);
      if (cellDef.formula) {
        const resultValue = cellDef.v == null ? undefined : (cellDef.v as string | number | boolean | Date);
        cell.value = { formula: cellDef.formula.replace(/^=/, ''), result: resultValue };
      } else if (cellDef.kind !== 'qrcode' && cellDef.kind !== 'barcode' && !cellDef.image) {
        cell.value = (cellDef.v ?? null) as ExcelJS.CellValue;
      } else {
        cell.value = typeof cellDef.v === 'string' ? cellDef.v : null;
      }
      applyStyle(cell, cellDef.s, cellDef.numFmt);
      const graphic = await renderGraphic(cellDef, imageCache);
      if (graphic) graphics.push({ cell: cellDef, graphic });
    }

    for (const merge of sheetResult.grid.merges ?? []) {
      if (merge.rowSpan <= 1 && merge.colSpan <= 1) continue;
      try {
        worksheet.mergeCells(merge.row + 1, merge.col + 1, merge.row + merge.rowSpan, merge.col + merge.colSpan);
      } catch {
        // ignore invalid merge
      }
    }

    for (const graphic of graphics) {
      const merge = findMerge(graphic.cell.row, graphic.cell.col, sheetResult.grid.merges ?? []);
      const imageId = workbook.addImage({
        base64: `data:image/${graphic.graphic.extension};base64,${graphic.graphic.buffer.toString('base64')}`,
        extension: graphic.graphic.extension,
      });
      worksheet.addImage(imageId, {
        tl: { col: graphic.cell.col + 0.05, row: graphic.cell.row + 0.05 } as unknown as ExcelJS.Anchor,
        br: {
          col: graphic.cell.col + (merge?.colSpan ?? 1) - 0.05,
          row: graphic.cell.row + (merge?.rowSpan ?? 1) - 0.05,
        } as unknown as ExcelJS.Anchor,
        editAs: 'oneCell',
      });
    }

    addExcelPageBreaks(worksheet, sheetResult.grid, sheetResult.pageConfig);
  }
  return totalRows;
}

function resolvePdfFontPath() {
  return PDF_FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resultContainsCjk(result: ReportPrintRenderResult): boolean {
  const hasCjk = (value: unknown) => /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(value ?? ''));
  return result.pages.some((page) =>
    hasCjk(page.headerText)
    || hasCjk(page.footerText)
    || page.grid.cells.some((cell) => hasCjk(cell.v)));
}

function pageInnerRect(page: PDFKit.PDFPage, config: ReportPrintPageConfig) {
  const margin = config.margin ?? { top: 12, right: 12, bottom: 12, left: 12 };
  return {
    x: mmToPt(margin.left),
    y: mmToPt(margin.top),
    width: page.width - mmToPt(margin.left + margin.right),
    height: page.height - mmToPt(margin.top + margin.bottom),
    marginBottom: mmToPt(margin.bottom),
  };
}

function textColor(color?: string) {
  return color && /^#?[0-9a-f]{6}$/i.test(color) ? (color.startsWith('#') ? color : `#${color}`) : '#111827';
}

function drawPdfBorder(doc: PDFKit.PDFDocument, border: ReportPrintBorder | null, x: number, y: number, width: number, height: number) {
  if (!border) return;
  const line = (x1: number, y1: number, x2: number, y2: number, color?: string) => {
    doc.save().lineWidth(0.5).strokeColor(textColor(color)).moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
  };
  if (border.top) line(x, y, x + width, y, border.top.color);
  if (border.right) line(x + width, y, x + width, y + height, border.right.color);
  if (border.bottom) line(x, y + height, x + width, y + height, border.bottom.color);
  if (border.left) line(x, y, x, y + height, border.left.color);
}

async function drawPdfGrid(doc: PDFKit.PDFDocument, pageResult: ReportPrintRenderPage, fontName: string, cache: Map<string, RenderedGraphic>) {
  const grid = pageResult.grid;
  const cellMap = new Map(grid.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  const merges = grid.merges ?? [];
  const rect = pageInnerRect(doc.page, pageResult.pageConfig);
  const headerOffset = pageResult.headerText ? 18 : 0;
  const footerOffset = pageResult.footerText ? 18 : 0;
  const originX = rect.x;
  const originY = rect.y + headerOffset;

  if (pageResult.headerText) {
    doc.font(fontName).fontSize(10).fillColor('#374151').text(pageResult.headerText, rect.x, rect.y - 4, {
      width: rect.width,
      align: 'center',
    });
  }
  if (pageResult.footerText) {
    doc.font(fontName).fontSize(10).fillColor('#374151').text(pageResult.footerText, rect.x, doc.page.height - rect.marginBottom + 2, {
      width: rect.width,
      align: 'center',
    });
  }

  const xPositions: number[] = [originX];
  for (let col = 0; col < Math.max(grid.cols, 1); col++) xPositions[col + 1] = xPositions[col] + pxToPt(grid.colWidths?.[col] ?? 96);
  const yPositions: number[] = [originY];
  for (let row = 0; row < Math.max(grid.rows, 1); row++) yPositions[row + 1] = yPositions[row] + pxToPt(grid.rowHeights?.[row] ?? 24);

  if (pageResult.pageConfig.backgroundImage) {
    const parsed = parseDataUrl(pageResult.pageConfig.backgroundImage);
    if (parsed) {
      doc.image(parsed.buffer, 0, 0, { fit: [doc.page.width, doc.page.height] });
    }
  }

  for (let row = 0; row < Math.max(grid.rows, 1); row++) {
    for (let col = 0; col < Math.max(grid.cols, 1); col++) {
      if (isCoveredByMerge(row, col, merges)) continue;
      const cell = cellMap.get(`${row}:${col}`);
      const merge = findMerge(row, col, merges);
      const width = xPositions[col + (merge?.colSpan ?? 1)] - xPositions[col];
      const height = yPositions[row + (merge?.rowSpan ?? 1)] - yPositions[row];
      const x = xPositions[col];
      const y = yPositions[row];
      if (cell?.s?.background) {
        doc.save().fillColor(textColor(cell.s.background)).rect(x, y, width, height).fill().restore();
      }
      drawPdfBorder(doc, normalizeBorder(cell?.s?.border), x, y, width, height);

      const graphic = cell ? await renderGraphic(cell, cache) : null;
      if (graphic) {
        doc.image(graphic.buffer, x + 2, y + 2, { fit: [Math.max(8, width - 4), Math.max(8, height - 4)], align: 'center', valign: 'center' });
        continue;
      }

      const value = cell?.v == null ? '' : String(cell.v);
      if (!value) continue;
      const fontSize = cell?.s?.fontSize ?? 10;
      doc.font(fontName).fontSize(fontSize).fillColor(textColor(cell?.s?.color));
      const textWidth = Math.max(8, width - 8);
      const textHeight = doc.heightOfString(value, { width: textWidth, align: cell?.s?.align ?? 'left' });
      const align = cell?.s?.align ?? 'left';
      let textY = y + 4;
      if (cell?.s?.valign === 'middle') textY = y + Math.max(2, (height - textHeight) / 2);
      if (cell?.s?.valign === 'bottom') textY = y + Math.max(2, height - textHeight - 4);
      doc.text(value, x + 4, textY, {
        width: textWidth,
        height: Math.max(8, height - 8 - footerOffset),
        align,
        lineBreak: cell?.s?.wrap !== false,
      });
    }
  }
}

export async function renderPrintResultToPdf(result: ReportPrintRenderResult): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  const chunks: Uint8Array[] = [];
  const imageCache = new Map<string, RenderedGraphic>();
  const fontPath = resolvePdfFontPath();
  if (!fontPath && resultContainsCjk(result)) {
    throw new Error('PDF 导出包含中文，但未找到 CJK 字体；请配置 REPORT_PDF_FONT_PATH');
  }
  const fontName = fontPath ? 'zh' : 'Helvetica';
  if (fontPath) doc.registerFont(fontName, fontPath);
  doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  for (const page of result.pages) {
    doc.addPage({
      size: PDF_PAPER_SIZE[page.pageConfig.paper ?? 'A4'] ?? 'A4',
      layout: page.pageConfig.orientation ?? 'portrait',
      margin: 0,
    });
    await drawPdfGrid(doc, page, fontName, imageCache);
  }
  await new Promise<void>((resolve) => {
    doc.on('end', () => resolve());
    doc.end();
  });
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export function reportPrintWorkUnits(result: ReportPrintRenderResult): number {
  return result.sheets.reduce((sum, sheet) => {
    const cells = Math.max(1, sheet.grid.rows) * Math.max(1, sheet.grid.cols);
    return sum + Math.max(sheet.rowCount, cells);
  }, 0);
}

export async function renderPrintExportFile(result: ReportPrintRenderResult, format: 'xlsx' | 'pdf'): Promise<{ buffer: Buffer; mimeType: string; rowCount: number }> {
  const rowCount = reportPrintWorkUnits(result);
  if (format === 'pdf') {
    return { buffer: await renderPrintResultToPdf(result), mimeType: 'application/pdf', rowCount };
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zenith Admin';
  workbook.created = new Date();
  await renderPrintResultToWorkbook(workbook, result);
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    rowCount,
  };
}
