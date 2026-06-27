import { LocaleType, type ICellData, type IRange, type IStyleData, type IWorkbookData } from '@univerjs/presets';
import type { ReportPrintCellStyle, ReportPrintGrid } from '@zenith/shared';

type Matrix<T> = { [row: number]: { [col: number]: T | null | undefined } };
type NumericArray<T> = { [index: number]: T };
type SheetSnapshot = {
  cellData?: Matrix<ICellData>;
  mergeData?: IRange[];
  columnData?: Record<string, { w?: number } | undefined>;
  rowData?: Record<string, { h?: number } | undefined>;
  rowCount?: number;
  columnCount?: number;
};

function hasValue(value: ICellData['v']) {
  return value !== undefined && value !== null && value !== '';
}

function resolveStyle(style: ICellData['s'], styles: IWorkbookData['styles']): IStyleData | null {
  if (!style) return null;
  if (typeof style === 'string') return styles?.[style] ?? null;
  return style;
}

function styleToGrid(style: IStyleData | null): ReportPrintCellStyle | undefined {
  if (!style) return undefined;
  const mapped: ReportPrintCellStyle = {};
  if (style.bl === 1) mapped.bold = true;
  if (style.it === 1) mapped.italic = true;
  if (typeof style.fs === 'number') mapped.fontSize = style.fs;
  if (style.cl?.rgb) mapped.color = style.cl.rgb;
  if (style.bg?.rgb) mapped.background = style.bg.rgb;
  if (style.ht === 1) mapped.align = 'left';
  if (style.ht === 2) mapped.align = 'center';
  if (style.ht === 3) mapped.align = 'right';
  if (style.vt === 1) mapped.valign = 'top';
  if (style.vt === 2) mapped.valign = 'middle';
  if (style.vt === 3) mapped.valign = 'bottom';
  if (style.tb === 3) mapped.wrap = true;
  if (style.bd) mapped.border = true;
  return Object.keys(mapped).length ? mapped : undefined;
}

function gridStyleToUniver(style: ReportPrintCellStyle | undefined): IStyleData | undefined {
  if (!style) return undefined;
  const mapped: IStyleData = {};
  if (style.bold) mapped.bl = 1;
  if (style.italic) mapped.it = 1;
  if (style.fontSize) mapped.fs = style.fontSize;
  if (style.color) mapped.cl = { rgb: style.color };
  if (style.background) mapped.bg = { rgb: style.background };
  if (style.align === 'left') mapped.ht = 1;
  if (style.align === 'center') mapped.ht = 2;
  if (style.align === 'right') mapped.ht = 3;
  if (style.valign === 'top') mapped.vt = 1;
  if (style.valign === 'middle') mapped.vt = 2;
  if (style.valign === 'bottom') mapped.vt = 3;
  if (style.wrap) mapped.tb = 3;
  if (style.border) {
    const thin = { s: 1, cl: { rgb: '#000000' } };
    mapped.bd = { t: thin, r: thin, b: thin, l: thin };
  }
  return Object.keys(mapped).length ? mapped : undefined;
}

function workbookBase(name: string, sheetId: string, sheet: IWorkbookData['sheets'][string]): IWorkbookData {
  return {
    id: `print-${Date.now().toString(36)}`,
    name,
    appVersion: '0.2.0',
    locale: LocaleType.ZH_CN,
    styles: {},
    sheetOrder: [sheetId],
    sheets: { [sheetId]: sheet },
  };
}

export function createBlankWorkbook(name: string): IWorkbookData {
  const sheetId = 'sheet-01';
  return workbookBase(name, sheetId, {
    id: sheetId,
    name: 'Sheet1',
    rowCount: 20,
    columnCount: 8,
    cellData: {},
    mergeData: [],
    rowData: {},
    columnData: {},
    defaultColumnWidth: 96,
    defaultRowHeight: 24,
  });
}

export function gridToUniver(grid: ReportPrintGrid, name = '打印模板'): IWorkbookData {
  const sheetId = 'sheet-01';
  const cellData: NumericArray<NumericArray<ICellData>> = {};
  const columnData: NumericArray<{ w?: number }> = {};
  const rowData: NumericArray<{ h?: number }> = {};
  let maxRow = Math.max(grid.rows - 1, 0);
  let maxCol = Math.max(grid.cols - 1, 0);

  grid.cells.forEach((cell) => {
    if (!cellData[cell.row]) cellData[cell.row] = {};
    const style = gridStyleToUniver(cell.s);
    cellData[cell.row][cell.col] = {
      v: cell.v as ICellData['v'],
      ...(style ? { s: style } : {}),
    };
    maxRow = Math.max(maxRow, cell.row);
    maxCol = Math.max(maxCol, cell.col);
  });

  const mergeData = (grid.merges ?? []).map((merge) => {
    const range = {
      startRow: merge.row,
      startColumn: merge.col,
      endRow: merge.row + merge.rowSpan - 1,
      endColumn: merge.col + merge.colSpan - 1,
    };
    maxRow = Math.max(maxRow, range.endRow);
    maxCol = Math.max(maxCol, range.endColumn);
    return range;
  });

  grid.colWidths?.forEach((w, col) => {
    if (typeof w === 'number') columnData[col] = { w };
  });
  grid.rowHeights?.forEach((h, row) => {
    if (typeof h === 'number') rowData[row] = { h };
  });

  return workbookBase(name, sheetId, {
    id: sheetId,
    name: 'Sheet1',
    rowCount: Math.max(maxRow + 1, 20),
    columnCount: Math.max(maxCol + 1, 8),
    cellData,
    mergeData,
    rowData,
    columnData,
    defaultColumnWidth: 96,
    defaultRowHeight: 24,
  });
}

export function univerToGrid(snapshot: IWorkbookData): ReportPrintGrid {
  const firstSheetId = snapshot.sheetOrder?.[0] ?? Object.keys(snapshot.sheets ?? {})[0];
  const sheet = (firstSheetId ? snapshot.sheets?.[firstSheetId] : undefined) as SheetSnapshot | undefined;
  if (!sheet) return { rows: 1, cols: 1, cells: [] };

  const cells: ReportPrintGrid['cells'] = [];
  const colWidths: number[] = [];
  const rowHeights: number[] = [];
  let maxRow = -1;
  let maxCol = -1;

  Object.entries(sheet.cellData ?? {}).forEach(([rowKey, rowCells]) => {
    const row = Number(rowKey);
    if (!Number.isFinite(row)) return;
    Object.entries(rowCells ?? {}).forEach(([colKey, cell]) => {
      const col = Number(colKey);
      if (!Number.isFinite(col) || !cell || !hasValue(cell.v)) return;
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
      const style = styleToGrid(resolveStyle(cell.s, snapshot.styles ?? {}));
      cells.push({
        row,
        col,
        v: cell.v as string | number | boolean | null,
        ...(style ? { s: style } : {}),
      });
    });
  });

  const merges = (sheet.mergeData ?? []).map((m) => {
    maxRow = Math.max(maxRow, m.endRow);
    maxCol = Math.max(maxCol, m.endColumn);
    return {
      row: m.startRow,
      col: m.startColumn,
      rowSpan: m.endRow - m.startRow + 1,
      colSpan: m.endColumn - m.startColumn + 1,
    };
  });

  Object.entries(sheet.columnData ?? {}).forEach(([key, value]) => {
    const col = Number(key);
    if (Number.isFinite(col) && typeof value?.w === 'number') colWidths[col] = value.w;
  });
  Object.entries(sheet.rowData ?? {}).forEach(([key, value]) => {
    const row = Number(key);
    if (Number.isFinite(row) && typeof value?.h === 'number') rowHeights[row] = value.h;
  });

  return {
    rows: Math.max(maxRow + 1, cells.length ? 1 : Math.min(sheet.rowCount ?? 20, 20)),
    cols: Math.max(maxCol + 1, cells.length ? 1 : Math.min(sheet.columnCount ?? 8, 8)),
    ...(colWidths.length ? { colWidths } : {}),
    ...(rowHeights.length ? { rowHeights } : {}),
    cells,
    ...(merges.length ? { merges } : {}),
  };
}
