import { createRequire } from 'node:module';
import type ExcelJS from 'exceljs';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeightRule,
  Header,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { IBorderOptions, ISectionOptions, ITableCellBorders } from 'docx';
import { resolvePdfFontPath } from './pdf-font';
import { findPrintMerge, isPrintCellCoveredByMerge } from '@zenith/shared/report';
import type { ReportPrintBorder, ReportPrintCell, ReportPrintCellStyle, ReportPrintGrid, ReportPrintPageConfig, ReportPrintRenderPage, ReportPrintRenderResult } from '@zenith/shared/report';

// 惰性加载：exceljs / pdfkit 模块图大（实测约 2.4s / 0.7s），仅在导出打印文件时加载
const require = createRequire(import.meta.url);
const loadExcelJS = () => require('exceljs') as typeof import('exceljs');
const loadPdfDocument = () => require('pdfkit') as typeof import('pdfkit');

const PAPER_SIZE: Record<NonNullable<ReportPrintPageConfig['paper']>, number> = { A4: 9, A3: 8, A5: 11, Letter: 1 };
const PDF_PAPER_SIZE: Record<NonNullable<ReportPrintPageConfig['paper']>, string> = { A4: 'A4', A3: 'A3', A5: 'A5', Letter: 'LETTER' };
const MM_TO_PX = 96 / 25.4;
const DOCX_PAPER_PX: Record<NonNullable<ReportPrintPageConfig['paper']>, { width: number; height: number }> = {
  A3: { width: 297 * MM_TO_PX, height: 420 * MM_TO_PX },
  A4: { width: 210 * MM_TO_PX, height: 297 * MM_TO_PX },
  A5: { width: 148 * MM_TO_PX, height: 210 * MM_TO_PX },
  Letter: { width: 8.5 * 96, height: 11 * 96 },
};
const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DOCX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_CELLS = 100_000;
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
      const merge = findPrintMerge(graphic.cell.row, graphic.cell.col, sheetResult.grid.merges ?? []);
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

function toDocxColor(color?: string) {
  let normalized = color?.trim().replace(/^#/, '');
  if (normalized?.length === 3) normalized = normalized.split('').map((item) => item + item).join('');
  return normalized && /^[\da-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : undefined;
}

function toDocxBorderSide(side?: { style?: string; color?: string }): IBorderOptions | undefined {
  if (!side) return undefined;
  const style = side.style === 'dashed'
    ? BorderStyle.DASHED
    : side.style === 'dotted'
      ? BorderStyle.DOTTED
      : side.style === 'double'
        ? BorderStyle.DOUBLE
        : BorderStyle.SINGLE;
  return {
    style,
    size: side.style === 'medium' ? 12 : 6,
    color: toDocxColor(side.color) ?? '111827',
  };
}

function toDocxBorders(style?: ReportPrintCellStyle): ITableCellBorders | undefined {
  const border = normalizeBorder(style?.border);
  if (!border) return undefined;
  return {
    top: toDocxBorderSide(border.top),
    right: toDocxBorderSide(border.right),
    bottom: toDocxBorderSide(border.bottom),
    left: toDocxBorderSide(border.left),
  };
}

function toDocxAlignment(alignment?: ReportPrintCellStyle['align']) {
  if (alignment === 'center') return AlignmentType.CENTER;
  if (alignment === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function toDocxVerticalAlignment(alignment?: ReportPrintCellStyle['valign']) {
  if (alignment === 'middle') return VerticalAlign.CENTER;
  if (alignment === 'bottom') return VerticalAlign.BOTTOM;
  return VerticalAlign.TOP;
}

function toDocxTextRuns(value: string, style?: ReportPrintCellStyle) {
  return value.split(/\r?\n/).map((text, index) => new TextRun({
    text,
    break: index === 0 ? undefined : 1,
    bold: style?.bold,
    italics: style?.italic,
    color: toDocxColor(style?.color),
    font: style?.fontFamily || 'Microsoft YaHei',
    size: Math.max(12, Math.round((style?.fontSize ?? 10) * 2)),
  }));
}

function docxParagraph(value: string, style?: ReportPrintCellStyle, image?: ImageRun) {
  return new Paragraph({
    alignment: toDocxAlignment(style?.align),
    spacing: { before: 0, after: 0, line: Math.max(240, Math.round((style?.fontSize ?? 10) * 24)) },
    children: image ? [image] : toDocxTextRuns(value, style),
  });
}

function getDocxPageDimensions(pageConfig: ReportPrintPageConfig) {
  const size = DOCX_PAPER_PX[pageConfig.paper ?? 'A4'];
  const landscape = pageConfig.orientation === 'landscape';
  return {
    width: Math.round(size.width * 15),
    height: Math.round(size.height * 15),
    orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
  };
}

function getDocxColumnWidths(page: ReportPrintRenderPage) {
  const dimensions = getDocxPageDimensions(page.pageConfig);
  const margin = page.pageConfig.margin ?? { top: 12, right: 12, bottom: 12, left: 12 };
  const pageWidth = page.pageConfig.orientation === 'landscape' ? dimensions.height : dimensions.width;
  const printableWidth = Math.max(720, pageWidth - Math.round((margin.left + margin.right) * MM_TO_PX * 15));
  const source = Array.from({ length: Math.max(page.grid.cols, 1) }, (_, col) => Math.max(1, page.grid.colWidths?.[col] ?? 96) * 15);
  const total = source.reduce((sum, width) => sum + width, 0) || printableWidth;
  const scale = Math.min(1, printableWidth / total);
  return source.map((width) => Math.max(60, Math.round(width * scale)));
}

function graphicKey(cell: ReportPrintCell) {
  return `${cell.row}:${cell.col}`;
}

function assertGridMergeBounds(grid: ReportPrintGrid) {
  const invalid = (grid.merges ?? []).find((merge) =>
    merge.row < 0
    || merge.col < 0
    || merge.row + merge.rowSpan > grid.rows
    || merge.col + merge.colSpan > grid.cols);
  if (invalid) {
    throw new Error(`合并区域 R${invalid.row + 1}C${invalid.col + 1} 超出打印网格范围`);
  }
}

async function buildDocxTable(page: ReportPrintRenderPage, budget: { imageBytes: number; cells: number; estimatedBytes: number }) {
  assertGridMergeBounds(page.grid);
  const imageCache = new Map<string, RenderedGraphic>();
  const cellMap = new Map(page.grid.cells.map((cell) => [graphicKey(cell), cell]));
  const graphicMap = new Map<string, RenderedGraphic>();
  for (const cell of page.grid.cells) {
    const graphic = await renderGraphic(cell, imageCache);
    if (graphic) graphicMap.set(graphicKey(cell), graphic);
  }
  const columnWidths = getDocxColumnWidths(page);
  const repeatHeaderRows = page.pageConfig.repeatHeaderRows
    ? page.pageConfig.repeatHeaderRows.end - page.pageConfig.repeatHeaderRows.start + 1
    : 0;
  const merges = page.grid.merges ?? [];
  const rows: TableRow[] = [];

  for (let row = 0; row < page.grid.rows; row += 1) {
    const cells: TableCell[] = [];
    for (let col = 0; col < page.grid.cols; col += 1) {
      if (isPrintCellCoveredByMerge(row, col, merges)) continue;
      budget.cells += 1;
      if (budget.cells > MAX_DOCX_CELLS) {
        throw new Error(`Word 文档单元格数量超过上限 ${MAX_DOCX_CELLS}`);
      }
      const cell = cellMap.get(`${row}:${col}`);
      const merge = findPrintMerge(row, col, merges);
      const graphic = graphicMap.get(`${row}:${col}`);
      const value = cell?.v == null ? '' : String(cell.v);
      budget.estimatedBytes += 256 + Buffer.byteLength(value, 'utf8');
      if (budget.estimatedBytes > MAX_DOCX_DOCUMENT_BYTES) {
        throw new Error(`Word 文档预计大小超过 ${MAX_DOCX_DOCUMENT_BYTES} 字节上限`);
      }
      const graphicSource = cell && (cell.kind === 'qrcode' || cell.kind === 'barcode' || cell.kind === 'image')
        ? String(cell.image?.src || cell.v || '').trim()
        : '';
      if (graphicSource && !graphic) {
        throw new Error(`单元格 R${row + 1}C${col + 1} 的图片格式不受 Word 导出支持`);
      }

      let image: ImageRun | undefined;
      if (graphic) {
        if (cell?.image?.fit === 'cover') {
          throw new Error(`单元格 R${row + 1}C${col + 1} 的 cover 图片裁剪不受 Word 导出支持`);
        }
        budget.imageBytes += graphic.buffer.length;
        budget.estimatedBytes += graphic.buffer.length;
        if (budget.imageBytes > MAX_DOCX_IMAGE_BYTES) {
          throw new Error(`Word 文档图片总大小超过 ${MAX_DOCX_IMAGE_BYTES} 字节上限`);
        }
        const availableWidth = Math.round(
          columnWidths.slice(col, col + (merge?.colSpan ?? 1)).reduce((sum, item) => sum + item, 0) / 15,
        );
        const availableHeight = Math.round(
          Array.from({ length: merge?.rowSpan ?? 1 }, (_, offset) => page.grid.rowHeights?.[row + offset] ?? 24)
            .reduce((sum, item) => sum + item, 0),
        );
        const width = Math.max(1, Math.min(1024, Math.round(cell?.image?.width ?? availableWidth), availableWidth));
        const height = Math.max(1, Math.min(1024, Math.round(cell?.image?.height ?? availableHeight), availableHeight));
        image = new ImageRun({
          type: graphic.extension === 'jpeg' ? 'jpg' : 'png',
          data: graphic.buffer,
          transformation: { width, height },
        });
      }

      cells.push(new TableCell({
        children: [docxParagraph(value, cell?.s, image)],
        columnSpan: merge?.colSpan,
        rowSpan: merge?.rowSpan,
        width: {
          size: columnWidths.slice(col, col + (merge?.colSpan ?? 1)).reduce((sum, item) => sum + item, 0),
          type: WidthType.DXA,
        },
        verticalAlign: toDocxVerticalAlignment(cell?.s?.valign),
        shading: cell?.s?.background ? {
          type: ShadingType.SOLID,
          fill: toDocxColor(cell.s.background),
          color: 'auto',
        } : undefined,
        borders: toDocxBorders(cell?.s),
        margins: {
          marginUnitType: WidthType.DXA,
          top: 60,
          right: 60,
          bottom: 60,
          left: 60,
        },
      }));
    }
    rows.push(new TableRow({
      children: cells,
      cantSplit: true,
      tableHeader: row < repeatHeaderRows,
      height: {
        value: Math.max(60, Math.round((page.grid.rowHeights?.[row] ?? 24) * 15)),
        rule: HeightRule.ATLEAST,
      },
    }));
  }

  return new Table({
    rows,
    columnWidths,
    width: { size: columnWidths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    margins: { marginUnitType: WidthType.DXA, top: 0, right: 0, bottom: 0, left: 0 },
  });
}

function buildDocxBand(text: string | undefined) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: text ?? '', font: 'Microsoft YaHei', size: 18 })],
  });
}

export async function renderPrintResultToDocx(result: ReportPrintRenderResult): Promise<Buffer> {
  if (result.pages.length === 0) throw new Error('打印结果不包含可导出的页面');
  const budget = { imageBytes: 0, cells: 0, estimatedBytes: 0 };
  const sections: ISectionOptions[] = [];

  for (const page of result.pages) {
    if (page.pageConfig.backgroundImage?.trim()) {
      throw new Error('Word 导出暂不支持页面背景图，请移除背景图后重试');
    }
    const dimensions = getDocxPageDimensions(page.pageConfig);
    const margin = page.pageConfig.margin ?? { top: 12, right: 12, bottom: 12, left: 12 };
    sections.push({
      properties: {
        page: {
          size: dimensions,
          margin: {
            top: Math.round(margin.top * MM_TO_PX * 15),
            right: Math.round(margin.right * MM_TO_PX * 15),
            bottom: Math.round(margin.bottom * MM_TO_PX * 15),
            left: Math.round(margin.left * MM_TO_PX * 15),
            header: Math.round(5 * MM_TO_PX * 15),
            footer: Math.round(5 * MM_TO_PX * 15),
          },
        },
      },
      headers: { default: new Header({ children: [buildDocxBand(page.headerText)] }) },
      footers: { default: new Footer({ children: [buildDocxBand(page.footerText)] }) },
      children: page.grid.rows > 0 && page.grid.cols > 0
        ? [await buildDocxTable(page, budget)]
        : [new Paragraph('')],
    });
  }

  const buffer = await Packer.toBuffer(new Document({
    creator: 'Zenith Admin',
    title: '报表打印',
    sections,
  }));
  if (buffer.length > MAX_DOCX_DOCUMENT_BYTES) {
    throw new Error(`Word 文档大小超过 ${MAX_DOCX_DOCUMENT_BYTES} 字节上限`);
  }
  return buffer;
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
  const line = (x1: number, y1: number, x2: number, y2: number, side?: ReportPrintBorder['top'], doubleX = 0, doubleY = 0) => {
    if (!side) return;
    const drawing = doc.save()
      .lineWidth(side.style === 'medium' ? 1.25 : 0.5)
      .strokeColor(textColor(side.color));
    if (side.style === 'dashed') drawing.dash(3, { space: 2 });
    if (side.style === 'dotted') drawing.dash(0.75, { space: 1.5 });
    drawing.moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
    if (side.style === 'double') {
      doc.save().lineWidth(0.5).strokeColor(textColor(side.color))
        .moveTo(x1 + doubleX, y1 + doubleY).lineTo(x2 + doubleX, y2 + doubleY).stroke().restore();
    }
  };
  if (border.top) line(x, y, x + width, y, border.top, 0, 2);
  if (border.right) line(x + width, y, x + width, y + height, border.right, -2, 0);
  if (border.bottom) line(x, y + height, x + width, y + height, border.bottom, 0, -2);
  if (border.left) line(x, y, x, y + height, border.left, 2, 0);
}

async function drawPdfGrid(doc: PDFKit.PDFDocument, pageResult: ReportPrintRenderPage, fontName: string, cache: Map<string, RenderedGraphic>) {
  const grid = pageResult.grid;
  assertGridMergeBounds(grid);
  const cellMap = new Map(grid.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  const merges = grid.merges ?? [];
  const rect = pageInnerRect(doc.page, pageResult.pageConfig);
  const headerOffset = pageResult.headerText ? 18 : 0;
  const originX = rect.x;
  const originY = rect.y + headerOffset;

  if (pageResult.pageConfig.backgroundImage) {
    const parsed = parseDataUrl(pageResult.pageConfig.backgroundImage);
    if (parsed) doc.image(parsed.buffer, 0, 0, { fit: [doc.page.width, doc.page.height] });
  }

  if (pageResult.headerText) {
    doc.font(fontName).fontSize(10).fillColor('#374151').text(pageResult.headerText, rect.x, rect.y - 4, {
      width: rect.width,
      height: 16,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
  }
  if (pageResult.footerText) {
    doc.font(fontName).fontSize(10).fillColor('#374151').text(pageResult.footerText, rect.x, doc.page.height - rect.marginBottom + 2, {
      width: rect.width,
      height: 16,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
  }

  const sourceWidths = Array.from({ length: Math.max(grid.cols, 1) }, (_, col) => pxToPt(grid.colWidths?.[col] ?? 96));
  const sourceWidth = sourceWidths.reduce((sum, width) => sum + width, 0);
  const widthScale = sourceWidth > rect.width ? rect.width / sourceWidth : 1;
  const xPositions: number[] = [originX];
  for (let col = 0; col < Math.max(grid.cols, 1); col++) {
    xPositions[col + 1] = xPositions[col] + sourceWidths[col] * widthScale;
  }
  const yPositions: number[] = [originY];
  for (let row = 0; row < Math.max(grid.rows, 1); row++) yPositions[row + 1] = yPositions[row] + pxToPt(grid.rowHeights?.[row] ?? 24);

  for (let row = 0; row < Math.max(grid.rows, 1); row++) {
    for (let col = 0; col < Math.max(grid.cols, 1); col++) {
      if (isPrintCellCoveredByMerge(row, col, merges)) continue;
      const cell = cellMap.get(`${row}:${col}`);
      const merge = findPrintMerge(row, col, merges);
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
        doc.save().rect(x + 1, y + 1, Math.max(1, width - 2), Math.max(1, height - 2)).clip();
        const imageSize: [number, number] = [Math.max(8, width - 4), Math.max(8, height - 4)];
        try {
          if (cell?.image?.fit === 'cover') {
            doc.image(graphic.buffer, x + 2, y + 2, { cover: imageSize, align: 'center', valign: 'center' });
          } else {
            doc.image(graphic.buffer, x + 2, y + 2, { fit: imageSize, align: 'center', valign: 'center' });
          }
        } catch {
          // 单张损坏 / 不支持的图片（如异常的签名 data URL）跳过，不让整份文件失败
        }
        doc.restore();
        continue;
      }

      const value = cell?.v == null ? '' : String(cell.v);
      if (!value) continue;
      const fontSize = cell?.s?.fontSize ?? 10;
      const color = textColor(cell?.s?.color);
      doc.font(fontName).fontSize(fontSize).fillColor(color);
      const textWidth = Math.max(8, width - 8);
      const textHeight = doc.heightOfString(value, { width: textWidth, align: cell?.s?.align ?? 'left' });
      const align = cell?.s?.align ?? 'left';
      let textY = y + 4;
      if (cell?.s?.valign === 'middle') textY = y + Math.max(2, (height - textHeight) / 2);
      if (cell?.s?.valign === 'bottom') textY = y + Math.max(2, height - textHeight - 4);
      doc.save().rect(x + 1, y + 1, Math.max(1, width - 2), Math.max(1, height - 2)).clip();
      // 只嵌入一个字重：加粗用细描边叠加填充模拟（标签 / 标题），避免再随包一份 Bold 字体
      const bold = cell?.s?.bold === true;
      if (bold) doc.strokeColor(color).lineWidth(Math.max(0.2, fontSize * 0.028));
      doc.text(value, x + 4, textY, {
        width: textWidth,
        height: Math.max(8, height - 8),
        align,
        lineBreak: cell?.s?.wrap !== false,
        ellipsis: true,
        ...(bold ? { fill: true, stroke: true } : {}),
      });
      doc.restore();
    }
  }
}

export interface PdfRenderOptions {
  /** 每页叠加的斜向半透明水印文本（换行分多行居中） */
  watermark?: string;
}

/** 水印：页面中心斜 30°，按 3×3 网格平铺，低不透明度不遮挡正文 */
function drawPdfWatermark(doc: PDFKit.PDFDocument, text: string, fontName: string) {
  const { width, height } = doc.page;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return;
  const fontSize = Math.max(14, Math.min(28, Math.floor(width / 24)));
  doc.save().fillOpacity(0.11).fillColor('#374151').font(fontName).fontSize(fontSize);
  const cellW = width / 3;
  const cellH = height / 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = cellW * col + cellW / 2;
      const cy = cellH * row + cellH / 2;
      doc.save().rotate(-30, { origin: [cx, cy] });
      lines.forEach((line, index) => {
        const lineWidth = doc.widthOfString(line);
        doc.text(line, cx - lineWidth / 2, cy - (lines.length * fontSize) / 2 + index * fontSize * 1.2, { lineBreak: false });
      });
      doc.restore();
    }
  }
  doc.restore();
}

export async function renderPrintResultToPdf(result: ReportPrintRenderResult, options: PdfRenderOptions = {}): Promise<Buffer> {
  const PDFDocument = loadPdfDocument();
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  const chunks: Uint8Array[] = [];
  const imageCache = new Map<string, RenderedGraphic>();
  const fontPath = resolvePdfFontPath();
  if (!fontPath && (resultContainsCjk(result) || /[\u3400-\u9fff]/u.test(options.watermark ?? ''))) {
    throw new Error('PDF 导出包含中文，但未找到 CJK 字体（内置 assets/fonts 缺失且未配置 REPORT_PDF_FONT_PATH）');
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
    if (options.watermark) drawPdfWatermark(doc, options.watermark, fontName);
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

export async function renderPrintExportFile(result: ReportPrintRenderResult, format: 'xlsx' | 'pdf' | 'docx'): Promise<{ buffer: Buffer; mimeType: string; rowCount: number }> {
  const rowCount = reportPrintWorkUnits(result);
  if (format === 'pdf') {
    return { buffer: await renderPrintResultToPdf(result), mimeType: 'application/pdf', rowCount };
  }
  if (format === 'docx') {
    return {
      buffer: await renderPrintResultToDocx(result),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      rowCount,
    };
  }
  const workbook = new (loadExcelJS().Workbook)();
  workbook.creator = 'Zenith Admin';
  await renderPrintResultToWorkbook(workbook, result);
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    rowCount,
  };
}
