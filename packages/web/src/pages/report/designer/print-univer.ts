import { LocaleType, type ICellData, type IRange, type IStyleData, type IWorkbookData } from '@univerjs/presets';
import type {
  ReportPrintBorder,
  ReportPrintCell,
  ReportPrintCellImage,
  ReportPrintCellStyle,
  ReportPrintContent,
  ReportPrintGrid,
  ReportPrintPageConfig,
  ReportPrintSheet,
} from '@zenith/shared';

type Matrix<T> = { [row: number]: { [col: number]: T | null | undefined } };
type NumericArray<T> = { [index: number]: T };
type SheetSnapshot = {
  id?: string;
  name?: string;
  cellData?: Matrix<ICellData & { custom?: { printImage?: ReportPrintCellImage; printKind?: ReportPrintCell['kind'] } }>;
  mergeData?: IRange[];
  columnData?: Record<string, { w?: number } | undefined>;
  rowData?: Record<string, { h?: number; ah?: number } | undefined>;
  rowCount?: number;
  columnCount?: number;
  defaultColumnWidth?: number;
  defaultRowHeight?: number;
  custom?: { printPageConfig?: ReportPrintPageConfig };
};

function hasRenderableCell(cell: ICellData & { custom?: { printImage?: ReportPrintCellImage } }) {
  return cell.v !== undefined || cell.f || cell.s || cell.custom?.printImage;
}

function resolveStyle(style: ICellData['s'], styles: IWorkbookData['styles']): IStyleData | null {
  if (!style) return null;
  if (typeof style === 'string') return styles?.[style] ?? null;
  return style;
}

function fromBorder(style: IStyleData['bd']): boolean | ReportPrintBorder | undefined {
  if (!style) return undefined;
  const mapSide = (side: { s?: number; cl?: { rgb?: string } } | undefined) => side
    ? { style: 'thin' as const, ...(side.cl?.rgb ? { color: side.cl.rgb } : {}) }
    : undefined;
  const border: ReportPrintBorder = {
    ...(style.t ? { top: mapSide(style.t as { s?: number; cl?: { rgb?: string } }) } : {}),
    ...(style.r ? { right: mapSide(style.r as { s?: number; cl?: { rgb?: string } }) } : {}),
    ...(style.b ? { bottom: mapSide(style.b as { s?: number; cl?: { rgb?: string } }) } : {}),
    ...(style.l ? { left: mapSide(style.l as { s?: number; cl?: { rgb?: string } }) } : {}),
  };
  const keys = Object.keys(border);
  if (!keys.length) return undefined;
  if (keys.length === 4 && keys.every((key) => (border as Record<string, unknown>)[key])) return border;
  return border;
}

function toBorder(border: boolean | ReportPrintBorder | undefined): IStyleData['bd'] | undefined {
  if (!border) return undefined;
  const normalized = border === true
    ? { top: { style: 'thin', color: '#000000' }, right: { style: 'thin', color: '#000000' }, bottom: { style: 'thin', color: '#000000' }, left: { style: 'thin', color: '#000000' } }
    : border;
  const side = (value: { color?: string } | undefined) => value ? { s: 1, cl: { rgb: value.color ?? '#000000' } } : undefined;
  const mapped: NonNullable<IStyleData['bd']> = {};
  if (normalized.top) mapped.t = side(normalized.top);
  if (normalized.right) mapped.r = side(normalized.right);
  if (normalized.bottom) mapped.b = side(normalized.bottom);
  if (normalized.left) mapped.l = side(normalized.left);
  return Object.keys(mapped).length ? mapped : undefined;
}

function styleToGrid(style: IStyleData | null): ReportPrintCellStyle | undefined {
  if (!style) return undefined;
  const mapped: ReportPrintCellStyle = {};
  if (style.ff) mapped.fontFamily = String(style.ff);
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
  const border = fromBorder(style.bd);
  if (border) mapped.border = border;
  return Object.keys(mapped).length ? mapped : undefined;
}

function gridStyleToUniver(style: ReportPrintCellStyle | undefined, numFmt?: string): IStyleData | undefined {
  if (!style && !numFmt) return undefined;
  const mapped: IStyleData = {};
  if (style?.fontFamily) mapped.ff = style.fontFamily;
  if (style?.bold) mapped.bl = 1;
  if (style?.italic) mapped.it = 1;
  if (style?.fontSize) mapped.fs = style.fontSize;
  if (style?.color) mapped.cl = { rgb: style.color };
  if (style?.background) mapped.bg = { rgb: style.background };
  if (style?.align === 'left') mapped.ht = 1;
  if (style?.align === 'center') mapped.ht = 2;
  if (style?.align === 'right') mapped.ht = 3;
  if (style?.valign === 'top') mapped.vt = 1;
  if (style?.valign === 'middle') mapped.vt = 2;
  if (style?.valign === 'bottom') mapped.vt = 3;
  if (style?.wrap) mapped.tb = 3;
  const border = toBorder(style?.border);
  if (border) mapped.bd = border;
  if (numFmt) mapped.n = { pattern: numFmt };
  return Object.keys(mapped).length ? mapped : undefined;
}

function workbookBase(name: string, sheets: ReportPrintSheet[]): IWorkbookData {
  const snapshotSheets: IWorkbookData['sheets'] = {};
  const sheetOrder: string[] = [];
  sheets.forEach((sheet) => {
    sheetOrder.push(sheet.id);
    snapshotSheets[sheet.id] = {
      id: sheet.id,
      name: sheet.name,
      rowCount: Math.max(sheet.grid.rows, 20),
      columnCount: Math.max(sheet.grid.cols, 8),
      cellData: {},
      mergeData: [],
      rowData: {},
      columnData: {},
      defaultColumnWidth: 96,
      defaultRowHeight: 24,
      custom: { printPageConfig: sheet.pageConfig },
    };
  });
  return {
    id: `print-${Date.now().toString(36)}`,
    name,
    appVersion: '0.2.0',
    locale: LocaleType.ZH_CN,
    styles: {},
    sheetOrder,
    sheets: snapshotSheets,
  };
}

export function createBlankWorkbook(name: string): IWorkbookData {
  return printContentToUniver({
    sheets: [{
      id: 'sheet-01',
      name: 'Sheet1',
      grid: { rows: 20, cols: 8, cells: [], rowHeights: [], colWidths: [] },
      pageConfig: { paper: 'A4', orientation: 'portrait' },
    }],
  }, name);
}

function sheetToUniver(sheet: ReportPrintSheet, snapshot: IWorkbookData, targetSheet: NonNullable<IWorkbookData['sheets'][string]>) {
  const cellData: NumericArray<NumericArray<ICellData & { custom?: { printImage?: ReportPrintCellImage; printKind?: ReportPrintCell['kind'] } }>> = {};
  const columnData: NumericArray<{ w?: number }> = {};
  const rowData: NumericArray<{ h?: number }> = {};
  let maxRow = Math.max(sheet.grid.rows - 1, 0);
  let maxCol = Math.max(sheet.grid.cols - 1, 0);

  sheet.grid.cells.forEach((cell) => {
    if (!cellData[cell.row]) cellData[cell.row] = {};
    const style = gridStyleToUniver(cell.s, cell.numFmt);
    const cellSnapshot: ICellData & { custom?: { printImage?: ReportPrintCellImage; printKind?: ReportPrintCell['kind'] } } = {
      ...(cell.v !== undefined ? { v: cell.v as ICellData['v'] } : {}),
      ...(cell.formula ? { f: cell.formula } : {}),
      ...(style ? { s: style } : {}),
      ...(cell.image || cell.kind ? { custom: { ...(cell.image ? { printImage: cell.image } : {}), ...(cell.kind ? { printKind: cell.kind } : {}) } } : {}),
    };
    cellData[cell.row][cell.col] = cellSnapshot;
    maxRow = Math.max(maxRow, cell.row);
    maxCol = Math.max(maxCol, cell.col);
  });

  const mergeData = (sheet.grid.merges ?? []).map((merge) => {
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

  sheet.grid.colWidths?.forEach((width, col) => { if (typeof width === 'number') columnData[col] = { w: width }; });
  sheet.grid.rowHeights?.forEach((height, row) => { if (typeof height === 'number') rowData[row] = { h: height }; });

  Object.assign(targetSheet, {
    id: sheet.id,
    name: sheet.name,
    rowCount: Math.max(maxRow + 1, sheet.grid.rows, 20),
    columnCount: Math.max(maxCol + 1, sheet.grid.cols, 8),
    cellData,
    mergeData,
    rowData,
    columnData,
    defaultColumnWidth: 96,
    defaultRowHeight: 24,
    custom: { printPageConfig: sheet.pageConfig },
  });
  snapshot.sheets[sheet.id] = targetSheet;
}

export function printContentToUniver(content: ReportPrintContent, name = '打印模板'): IWorkbookData {
  const sheets = content.sheets?.length
    ? content.sheets
    : [{ id: 'sheet-01', name: 'Sheet1', grid: content.grid ?? { rows: 20, cols: 8, cells: [] } }];
  const snapshot = workbookBase(name, sheets);
  sheets.forEach((sheet) => sheetToUniver(sheet, snapshot, snapshot.sheets[sheet.id]!));
  return snapshot;
}

export function gridToUniver(grid: ReportPrintGrid, name = '打印模板'): IWorkbookData {
  return printContentToUniver({ grid }, name);
}

function snapshotSheetToGrid(sheet: SheetSnapshot, styles: IWorkbookData['styles']): ReportPrintGrid {
  const cells: ReportPrintGrid['cells'] = [];
  const colWidths: number[] = [];
  const rowHeights: number[] = [];
  let maxRow = Math.max((sheet.rowCount ?? 1) - 1, 0);
  let maxCol = Math.max((sheet.columnCount ?? 1) - 1, 0);

  Object.entries(sheet.cellData ?? {}).forEach(([rowKey, rowCells]) => {
    const row = Number(rowKey);
    if (!Number.isFinite(row)) return;
    Object.entries(rowCells ?? {}).forEach(([colKey, cell]) => {
      const col = Number(colKey);
      if (!Number.isFinite(col) || !cell || !hasRenderableCell(cell)) return;
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
      const style = styleToGrid(resolveStyle(cell.s, styles ?? {}));
      const styleData = resolveStyle(cell.s, styles ?? {});
      cells.push({
        row,
        col,
        ...(cell.v !== undefined ? { v: cell.v as string | number | boolean | null } : {}),
        ...(style ? { s: style } : {}),
        ...(cell.f ? { formula: String(cell.f), kind: 'formula' as const } : {}),
        ...(styleData?.n && typeof styleData.n === 'object' && 'pattern' in styleData.n && typeof styleData.n.pattern === 'string' ? { numFmt: styleData.n.pattern } : {}),
        ...(cell.custom?.printImage ? { image: cell.custom.printImage } : {}),
        ...(cell.custom?.printKind ? { kind: cell.custom.printKind } : {}),
      });
    });
  });

  const merges = (sheet.mergeData ?? []).map((merge) => {
    maxRow = Math.max(maxRow, merge.endRow);
    maxCol = Math.max(maxCol, merge.endColumn);
    return {
      row: merge.startRow,
      col: merge.startColumn,
      rowSpan: merge.endRow - merge.startRow + 1,
      colSpan: merge.endColumn - merge.startColumn + 1,
    };
  });

  Object.entries(sheet.columnData ?? {}).forEach(([key, value]) => {
    const col = Number(key);
    if (Number.isFinite(col) && typeof value?.w === 'number') colWidths[col] = value.w;
  });
  Object.entries(sheet.rowData ?? {}).forEach(([key, value]) => {
    const row = Number(key);
    if (Number.isFinite(row)) rowHeights[row] = value?.h ?? value?.ah ?? 24;
  });

  return {
    rows: Math.max(maxRow + 1, sheet.rowCount ?? 20),
    cols: Math.max(maxCol + 1, sheet.columnCount ?? 8),
    ...(colWidths.length ? { colWidths } : {}),
    ...(rowHeights.length ? { rowHeights } : {}),
    cells,
    ...(merges.length ? { merges } : {}),
  };
}

export function univerToPrintContent(snapshot: IWorkbookData): ReportPrintContent {
  const sheetIds = snapshot.sheetOrder?.length ? snapshot.sheetOrder : Object.keys(snapshot.sheets ?? {});
  const sheets: ReportPrintSheet[] = sheetIds.map((sheetId, index) => {
    const sheet = snapshot.sheets?.[sheetId] as SheetSnapshot | undefined;
    if (!sheet) {
      return {
        id: sheetId,
        name: `Sheet${index + 1}`,
        grid: { rows: 20, cols: 8, cells: [] },
      };
    }
    return {
      id: sheet.id ?? sheetId,
      name: sheet.name ?? `Sheet${index + 1}`,
      grid: snapshotSheetToGrid(sheet, snapshot.styles ?? {}),
      ...(sheet.custom?.printPageConfig ? { pageConfig: sheet.custom.printPageConfig } : {}),
    };
  });
  return {
    workbook: snapshot,
    ...(sheets[0]?.grid ? { grid: sheets[0].grid } : {}),
    sheets,
  };
}

export function univerToGrid(snapshot: IWorkbookData): ReportPrintGrid {
  return univerToPrintContent(snapshot).grid ?? { rows: 1, cols: 1, cells: [] };
}
