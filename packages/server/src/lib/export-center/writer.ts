import ExcelJS from 'exceljs';
import { csvEscapeCell } from '../excel-export';
import { formatDateTime } from '../datetime';
import { formatExportCell } from './formatter';
import type { AnyExportDefinition, ExportColumn, ExportRuntimeContext, ExportStyleSet } from './types';

interface HeaderCell<TRow extends Record<string, unknown>> {
  column: ExportColumn<TRow>;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

const DEFAULT_STYLES: Required<ExportStyleSet> = {
  title: {
    font: { bold: true, size: 16 },
    alignment: { horizontal: 'center', vertical: 'middle' },
  },
  meta: {
    font: { size: 10, color: { argb: 'FF666666' } },
    alignment: { vertical: 'middle' },
  },
  header: {
    font: { bold: true },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } },
    border: {
      top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    },
  },
  body: {
    alignment: { vertical: 'middle' },
    border: {
      top: { style: 'thin', color: { argb: 'FFEDEDED' } },
      left: { style: 'thin', color: { argb: 'FFEDEDED' } },
      bottom: { style: 'thin', color: { argb: 'FFEDEDED' } },
      right: { style: 'thin', color: { argb: 'FFEDEDED' } },
    },
  },
  summary: {
    font: { bold: true },
  },
};

function mergeStyle(...styles: Array<Partial<ExcelJS.Style> | undefined>): Partial<ExcelJS.Style> {
  return Object.assign({}, ...styles.filter(Boolean));
}

export function leafColumns<TRow extends Record<string, unknown>>(columns: ExportColumn<TRow>[]): ExportColumn<TRow>[] {
  return columns.flatMap((column) => column.children?.length ? leafColumns(column.children) : [column]);
}

/** 解析定义的列：优先动态 resolveColumns，否则用静态 columns */
async function resolveDefinitionColumns(
  definition: AnyExportDefinition,
  ctx: ExportRuntimeContext,
): Promise<ExportColumn[]> {
  if (definition.resolveColumns) {
    return await definition.resolveColumns(ctx.query, ctx.currentUser);
  }
  return definition.columns;
}

function maxDepth(columns: ExportColumn[]): number {
  return Math.max(...columns.map((column) => column.children?.length ? 1 + maxDepth(column.children) : 1), 1);
}

function countLeaves<TRow extends Record<string, unknown>>(column: ExportColumn<TRow>): number {
  return column.children?.length ? column.children.reduce((sum, child) => sum + countLeaves(child), 0) : 1;
}

function buildHeaderCells<TRow extends Record<string, unknown>>(
  columns: ExportColumn<TRow>[],
  depth: number,
  row = 1,
  startCol = 1,
): HeaderCell<TRow>[] {
  const cells: HeaderCell<TRow>[] = [];
  let col = startCol;
  for (const column of columns) {
    const colSpan = countLeaves(column);
    const hasChildren = !!column.children?.length;
    const rowSpan = hasChildren ? 1 : depth - row + 1;
    cells.push({ column, row, col, rowSpan, colSpan });
    if (hasChildren) {
      cells.push(...buildHeaderCells(column.children as ExportColumn<TRow>[], depth, row + 1, col));
    }
    col += colSpan;
  }
  return cells;
}

function applyCellStyle(cell: ExcelJS.Cell, style?: Partial<ExcelJS.Style>) {
  if (!style) return;
  Object.assign(cell, { style: mergeStyle(cell.style, style) });
}

function selectedColumns<TRow extends Record<string, unknown>>(
  columns: ExportColumn<TRow>[],
  selected: string[] | null,
): ExportColumn<TRow>[] {
  if (!selected?.length) return columns;
  const selectedSet = new Set(selected);
  const filter = (items: ExportColumn<TRow>[]): ExportColumn<TRow>[] =>
    items
      .map((item) => {
        if (item.children?.length) {
          const children = filter(item.children);
          return children.length > 0 ? { ...item, children } : null;
        }
        return item.key && selectedSet.has(item.key) ? item : null;
      })
      .filter((item): item is ExportColumn<TRow> => item != null);
  return filter(columns);
}

function appendMetadataSheet(workbook: ExcelJS.Workbook, ctx: ExportRuntimeContext) {
  if (!ctx.watermark) return;
  const sheet = workbook.addWorksheet('导出信息', { state: 'hidden' });
  sheet.columns = [{ width: 18 }, { width: 80 }];
  const rows = [
    ['任务 ID', ctx.jobId],
    ['导出实体', ctx.entity],
    ['业务模块', ctx.moduleName],
    ['导出人', ctx.createdByName ?? ctx.currentUser.username],
    ['用户 ID', ctx.currentUser.userId],
    ['租户 ID', ctx.currentUser.tenantId ?? '平台'],
    ['导出时间', formatDateTime(ctx.exportedAt)],
    ['格式', ctx.format],
    ['是否明文', ctx.raw ? '是' : '否'],
    ['是否脱敏', ctx.masked ? '是' : '否'],
    ['是否包含敏感字段', ctx.sensitive ? '是' : '否'],
    ['筛选条件', JSON.stringify(ctx.query)],
    ['字段', ctx.selectedColumns?.join(', ') ?? '全部字段'],
  ];
  for (const row of rows) sheet.addRow(row);
}

async function writeTableSheet(
  workbook: ExcelJS.Workbook,
  definition: AnyExportDefinition,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
  ctx: ExportRuntimeContext,
) {
  const columns = selectedColumns(await resolveDefinitionColumns(definition, ctx), ctx.selectedColumns);
  const leaves = leafColumns(columns);
  const sheet = workbook.addWorksheet(definition.sheetName ?? definition.moduleName);
  const styles = { ...DEFAULT_STYLES, ...definition.styles };
  const headerDepth = maxDepth(columns);
  const titleRows = ctx.watermark ? 2 : 0;
  let headerStartRow = titleRows + 1;

  if (ctx.watermark) {
    const lastCol = Math.max(leaves.length, 1);
    sheet.mergeCells(1, 1, 1, lastCol);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = definition.filenamePrefix;
    applyCellStyle(titleCell, styles.title);
    sheet.mergeCells(2, 1, 2, lastCol);
    const metaCell = sheet.getCell(2, 1);
    metaCell.value = `导出人：${ctx.createdByName ?? ctx.currentUser.username}    导出时间：${formatDateTime(ctx.exportedAt)}    任务号：${ctx.jobId}`;
    applyCellStyle(metaCell, styles.meta);
    headerStartRow = 3;
  }

  const headerCells = buildHeaderCells(columns, headerDepth);
  for (const header of headerCells) {
    const row = headerStartRow + header.row - 1;
    const col = header.col;
    const cell = sheet.getCell(row, col);
    cell.value = header.column.header;
    applyCellStyle(cell, mergeStyle(styles.header, header.column.headerStyle));
    if (header.rowSpan > 1 || header.colSpan > 1) {
      sheet.mergeCells(row, col, row + header.rowSpan - 1, col + header.colSpan - 1);
    }
  }

  leaves.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width ?? 18;
  });

  const filterHeaderRow = headerStartRow + headerDepth - 1;
  let rowIndex = filterHeaderRow;
  for await (const sourceRow of rows) {
    const values = leaves.map((column) => formatExportCell(column, sourceRow, ctx));
    const excelRow = sheet.insertRow(++rowIndex, values);
    leaves.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      applyCellStyle(cell, mergeStyle(styles.body, column.style));
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: filterHeaderRow }];
  sheet.autoFilter = {
    from: { row: filterHeaderRow, column: 1 },
    to: { row: rowIndex, column: Math.max(leaves.length, 1) },
  };
}

export async function renderExportWorkbook(
  definition: AnyExportDefinition,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
  ctx: ExportRuntimeContext,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zenith Admin';
  workbook.created = ctx.exportedAt;
  if (definition.renderMode === 'custom' && definition.renderWorkbook) {
    await definition.renderWorkbook(workbook, ctx);
  } else {
    await writeTableSheet(workbook, definition, rows, ctx);
  }
  appendMetadataSheet(workbook, ctx);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function renderExportCsv(
  definition: AnyExportDefinition,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
  ctx: ExportRuntimeContext,
): Promise<Buffer> {
  if (definition.renderMode !== 'table') {
    throw new Error('该导出包含复杂布局或自定义样式，仅支持 Excel 格式');
  }
  const columns = leafColumns(selectedColumns(await resolveDefinitionColumns(definition, ctx), ctx.selectedColumns));
  const lines = [columns.map((column) => csvEscapeCell(column.header)).join(',')];
  for await (const row of rows) {
    lines.push(columns.map((column) => csvEscapeCell(formatExportCell(column, row, ctx))).join(','));
  }
  return Buffer.from('\uFEFF' + lines.join('\n') + '\n', 'utf-8');
}
