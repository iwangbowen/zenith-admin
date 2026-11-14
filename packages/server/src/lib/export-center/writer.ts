import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import type ExcelJS from 'exceljs';
import { csvEscapeCell } from '../excel-export';
import { formatDateTime } from '../datetime';
import { formatExportCell, excelExportCell } from './formatter';
import type { AnyExportDefinition, ExportColumn, ExportRuntimeContext, ExportStyleSet } from './types';

// 惰性加载：exceljs 模块图大（实测 ~2.4s），仅在执行导出任务时加载
const require = createRequire(import.meta.url);
const loadExcelJS = () => require('exceljs') as typeof import('exceljs');

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
  const leaves = leafColumns(columns);
  return selected.flatMap(key => { const column = leaves.find(item => item.key === key); return column ? [column] : []; });
}

async function writeTableSheetStreaming(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  definition: AnyExportDefinition,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
  ctx: ExportRuntimeContext,
) {
  const columns = selectedColumns(await resolveDefinitionColumns(definition, ctx), ctx.selectedColumns);
  const leaves = leafColumns(columns);
  const styles = { ...DEFAULT_STYLES, ...definition.styles };
  const headerDepth = maxDepth(columns);
  const titleRows = ctx.watermark ? 2 : 0;
  const filterHeaderRow = titleRows + headerDepth;

  const sheet = workbook.addWorksheet(definition.sheetName ?? definition.moduleName, {
    views: [{ state: 'frozen', ySplit: filterHeaderRow }],
  });
  sheet.columns = leaves.map((column) => ({ width: column.width ?? 18 }));

  // 表头区（标题 / 元信息 / 多级表头）：流式 writer 中行一旦 commit 便不可再改，
  // 先整体构建、赋值与合并完成后再按序 commit
  const headRows = Array.from({ length: filterHeaderRow }, () => sheet.addRow([]));
  if (ctx.watermark) {
    const lastCol = Math.max(leaves.length, 1);
    const titleCell = headRows[0].getCell(1);
    titleCell.value = definition.filenamePrefix;
    applyCellStyle(titleCell, styles.title);
    sheet.mergeCells(1, 1, 1, lastCol);
    const metaCell = headRows[1].getCell(1);
    metaCell.value = `导出人：${ctx.createdByName ?? ctx.currentUser.username}    导出时间：${formatDateTime(ctx.exportedAt)}    任务号：${ctx.jobId}`;
    applyCellStyle(metaCell, styles.meta);
    sheet.mergeCells(2, 1, 2, lastCol);
  }
  for (const header of buildHeaderCells(columns, headerDepth)) {
    const row = titleRows + header.row;
    const cell = headRows[row - 1].getCell(header.col);
    cell.value = header.column.header;
    applyCellStyle(cell, mergeStyle(styles.header, header.column.headerStyle));
    if (header.rowSpan > 1 || header.colSpan > 1) {
      sheet.mergeCells(row, header.col, row + header.rowSpan - 1, header.col + header.colSpan - 1);
    }
  }
  for (const row of headRows) row.commit();

  // 数据区：逐行 addRow + commit，行 XML 增量序列化，CPU 随分页取数循环摊开，
  // 不存在对整本 workbook 的终局连续序列化段
  const bodyStyles = leaves.map((column) => mergeStyle(styles.body, column.style));
  let rowIndex = filterHeaderRow;
  let written = 0;
  for await (const sourceRow of rows) {
    // 渲染兜底：countRows 不准或恒为 0 的定义在此拦截，防止无界行数
    if (ctx.rowLimit && ctx.rowLimit > 0 && ++written > ctx.rowLimit) {
      throw new Error(`导出行数超过上限 ${ctx.rowLimit} 行，请收窄筛选条件或分批导出`);
    }
    const excelRow = sheet.addRow(leaves.map((column) => excelExportCell(column, sourceRow, ctx)));
    rowIndex++;
    leaves.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      applyCellStyle(cell, bodyStyles[index]);
      if (column.type === 'money' && typeof cell.value === 'number') cell.numFmt = '#,##0.00';
    });
    excelRow.commit();
  }

  sheet.autoFilter = {
    from: { row: filterHeaderRow, column: 1 },
    to: { row: rowIndex, column: Math.max(leaves.length, 1) },
  };
  sheet.commit();
}

function appendMetadataSheetStreaming(workbook: ExcelJS.stream.xlsx.WorkbookWriter, ctx: ExportRuntimeContext) {
  if (!ctx.watermark) return;
  const sheet = workbook.addWorksheet('导出信息', { state: 'hidden' });
  sheet.columns = [{ width: 18 }, { width: 80 }];
  for (const row of metadataRows(ctx)) sheet.addRow(row).commit();
  sheet.commit();
}

function metadataRows(ctx: ExportRuntimeContext): Array<Array<string | number>> {
  return [
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
    ['筛选条件', '详细条件仅在受控任务详情中查看'],
    ['字段', ctx.selectedColumns?.join(', ') ?? '全部字段'],
  ];
}

function appendMetadataSheet(workbook: ExcelJS.Workbook, ctx: ExportRuntimeContext) {
  if (!ctx.watermark) return;
  const sheet = workbook.addWorksheet('导出信息', { state: 'hidden' });
  sheet.columns = [{ width: 18 }, { width: 80 }];
  for (const row of metadataRows(ctx)) sheet.addRow(row);
}

export async function renderExportWorkbook(
  definition: AnyExportDefinition,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
  ctx: ExportRuntimeContext,
): Promise<Buffer> {
  // custom：定义方直接操作内存 Workbook（报表打印等自带单元格/字节预算），保留 Buffer 路径
  if (definition.renderMode === 'custom' && definition.renderWorkbook) {
    const workbook = new (loadExcelJS().Workbook)();
    workbook.creator = 'Zenith Admin';
    workbook.created = ctx.exportedAt;
    await definition.renderWorkbook(workbook, ctx);
    appendMetadataSheet(workbook, ctx);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
  // table：流式 WorkbookWriter 逐行 commit 增量序列化，消除 writeBuffer() 的
  // 整本终局序列化连续 CPU 段与全量 worksheet 对象图驻留
  const passThrough = new PassThrough();
  const chunks: Buffer[] = [];
  passThrough.on('data', (chunk: Buffer) => chunks.push(chunk));
  const streamDone = new Promise<void>((resolve, reject) => {
    passThrough.on('end', resolve);
    passThrough.on('error', reject);
  });
  const workbook = new (loadExcelJS().stream.xlsx.WorkbookWriter)({ stream: passThrough, useStyles: true });
  workbook.creator = 'Zenith Admin';
  workbook.created = ctx.exportedAt;
  try {
    await writeTableSheetStreaming(workbook, definition, rows, ctx);
    appendMetadataSheetStreaming(workbook, ctx);
    await workbook.commit();
    await streamDone;
    return Buffer.concat(chunks);
  } catch (err) {
    passThrough.destroy();
    throw err;
  }
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
  let written = 0;
  for await (const row of rows) {
    if (ctx.rowLimit && ctx.rowLimit > 0 && ++written > ctx.rowLimit) {
      throw new Error(`导出行数超过上限 ${ctx.rowLimit} 行，请收窄筛选条件或分批导出`);
    }
    lines.push(columns.map((column) => csvEscapeCell(formatExportCell(column, row, ctx))).join(','));
  }
  return Buffer.from('\uFEFF' + lines.join('\n') + '\n', 'utf-8');
}

/** Disk-backed table output for large snapshot providers; neither CSV nor XLSX accumulates a full Buffer. */
export async function renderExportToPath(
  definition: AnyExportDefinition,
  rows: AsyncIterable<Record<string, unknown>>,
  ctx: ExportRuntimeContext,
  filePath: string,
  total: number,
): Promise<number> {
  const output = createWriteStream(filePath, { flags: 'wx' });
  const done = finished(output);
  // A query/row failure can precede awaiting the file completion promise.
  void done.catch(() => undefined);
  let written = 0;
  async function* countedRows() {
    await ctx.progress?.(0, total);
    for await (const row of rows) {
      if (ctx.rowLimit && written >= ctx.rowLimit) throw new Error(`导出行数超过上限 ${ctx.rowLimit} 行，请收窄筛选条件`);
      if (output.bytesWritten > (ctx.byteLimit ?? 128 * 1024 * 1024)) throw new Error('导出文件超过字节预算，请收窄条件');
      yield row;
      written += 1;
      if (written % 250 === 0) await ctx.progress?.(written, total);
    }
  }
  try {
    if (ctx.format === 'csv') {
      const columns = leafColumns(selectedColumns(await resolveDefinitionColumns(definition, ctx), ctx.selectedColumns));
      const write = async (line: string) => { if (!output.write(line)) await once(output, 'drain'); };
      await write('\uFEFF' + columns.map((column) => csvEscapeCell(column.header)).join(',') + '\r\n');
      for await (const row of countedRows()) await write(columns.map((column) => csvEscapeCell(formatExportCell(column, row, ctx))).join(',') + '\r\n');
      output.end();
    } else {
      const workbook = new (loadExcelJS().stream.xlsx.WorkbookWriter)({ stream: output, useStyles: true });
      workbook.creator = 'Zenith Admin';
      workbook.created = ctx.exportedAt;
      await writeTableSheetStreaming(workbook, definition, countedRows(), ctx);
      appendMetadataSheetStreaming(workbook, ctx);
      await workbook.commit();
    }
    await done;
    if (output.bytesWritten > (ctx.byteLimit ?? 128 * 1024 * 1024)) throw new Error('导出文件超过字节预算，请收窄条件');
    await ctx.progress?.(written, total);
    return written;
  } catch (error) {
    output.destroy();
    await done.catch(() => undefined);
    throw error;
  }
}
