import type { ReportPrintBorder, ReportPrintCell, ReportPrintContent, ReportPrintCrosstabConfig, ReportPrintCrosstabValueField, ReportPrintDatasetBinding, ReportPrintGrid, ReportPrintMerge, ReportPrintPageConfig, ReportPrintRenderPage, ReportPrintRenderResult, ReportPrintRowRange, ReportPrintSheet, ReportPrintSheetRenderResult } from './contracts';
import type { ReportPrintDatasetRows, ReportPrintRenderOptions } from './types';

type Row = Record<string, unknown>;

const AGG_RE = /^(SUM|COUNT|AVG|MAX|MIN)\(\s*([\w.]+)\s*\)$/i;
const GROUP_AGG_RE = /^GROUP_(SUM|COUNT|AVG|MAX|MIN)\(\s*([\w.]+)\s*\)$/i;
const PAGE_AGG_RE = /^PAGE_(SUM|COUNT|AVG|MAX|MIN)\(\s*([\w.]+)\s*\)$/i;
const QRCODE_RE = /^QRCODE\(\s*([\w.]+)\s*\)$/i;
const BARCODE_RE = /^(?:CODE128|BARCODE)\(\s*([\w.]+)\s*\)$/i;
const EXPR_RE = /([#$])\{([^}]+)\}/g;
const MM_TO_PX = 96 / 25.4;
const DEFAULT_ROW_HEIGHT = 24;
export const DEFAULT_PRINT_CROSSTAB_BUDGET = {
  maxDynamicColumns: 256,
  maxCells: 100_000,
  maxBytes: 8 * 1024 * 1024,
} as const;
const PAPER_SIZE_MM: Record<NonNullable<ReportPrintPageConfig['paper']>, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A5: [148, 210],
  Letter: [216, 279],
};

interface TokenContext {
  row: Row | null;
  rows: Row[];
  groupRows: Row[];
  pageRows: Row[];
  params: Record<string, unknown>;
  paramNames: Set<string>;
  datasetKey?: string;
}

interface SpecialToken {
  kind: 'qrcode' | 'barcode';
  value: string;
}

interface RenderedGridState {
  grid: ReportPrintGrid;
  rowDetails: Row[][];
  templateRowToOutputRows: number[][];
}

interface DatasetContext {
  rows: ReportPrintDatasetRows;
  bindings: Map<string, ReportPrintDatasetBinding>;
  joinIndexes: Map<string, Map<unknown, Row[]>>;
}

export class ReportPrintValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReportPrintValidationError';
    this.code = code;
  }
}

export function isPrintCellCoveredByMerge(row: number, col: number, merges: ReportPrintMerge[]): boolean {
  return merges.some((merge) =>
    row >= merge.row
    && row < merge.row + merge.rowSpan
    && col >= merge.col
    && col < merge.col + merge.colSpan
    && !(row === merge.row && col === merge.col));
}

export function findPrintMerge(row: number, col: number, merges: ReportPrintMerge[]): ReportPrintMerge | undefined {
  return merges.find((merge) => merge.row === row && merge.col === col);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getValue(source: unknown, path: string): unknown {
  if (!path) return source;
  return path.split('.').reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), source);
}

function normalizeDatasetKey(key: string | null | undefined): string {
  return key?.trim().toLowerCase() || 'main';
}

function buildDatasetContext(
  mainRows: Row[],
  options?: ReportPrintRenderOptions,
): DatasetContext {
  const rows: ReportPrintDatasetRows = { main: mainRows };
  for (const [key, value] of Object.entries(options?.datasets ?? {})) {
    rows[normalizeDatasetKey(key)] = Array.isArray(value) ? value : [];
  }
  const bindings = new Map<string, ReportPrintDatasetBinding>();
  for (const binding of options?.bindings ?? []) bindings.set(normalizeDatasetKey(binding.key), binding);
  return { rows, bindings, joinIndexes: new Map() };
}

function rowsForDataset(datasetContext: DatasetContext, key: string | null | undefined, ctx?: TokenContext): Row[] {
  const normalizedKey = normalizeDatasetKey(key);
  const rows = datasetContext.rows[normalizedKey] ?? [];
  const binding = datasetContext.bindings.get(normalizedKey);
  if (!binding?.parentKey || !binding.parentField || !binding.childField || !ctx?.row) return rows;
  if (normalizeDatasetKey(binding.parentKey) !== normalizeDatasetKey(ctx.datasetKey)) return rows;
  const parentValue = getValue(ctx.row, binding.parentField);
  let index = datasetContext.joinIndexes.get(normalizedKey);
  if (!index) {
    index = new Map();
    for (const row of rows) {
      const value = getValue(row, binding.childField);
      const matches = index.get(value);
      if (matches) matches.push(row);
      else index.set(value, [row]);
    }
    datasetContext.joinIndexes.set(normalizedKey, index);
  }
  return index.get(parentValue) ?? [];
}

function contextForCell(cell: ReportPrintCell, ctx: TokenContext, datasetContext?: DatasetContext): TokenContext {
  if (!cell.datasetKey || !datasetContext) return ctx;
  const key = normalizeDatasetKey(cell.datasetKey);
  if (key === normalizeDatasetKey(ctx.datasetKey)) return ctx;
  const rows = rowsForDataset(datasetContext, key, ctx);
  return {
    ...ctx,
    datasetKey: key,
    row: rows[0] ?? null,
    rows,
    groupRows: rows,
    pageRows: rows,
  };
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function aggregate(rows: Row[], fn: string, field: string): number {
  const op = fn.toUpperCase();
  if (op === 'COUNT') return rows.length;
  const nums = rows.map((row) => toNum(getValue(row, field)));
  if (nums.length === 0) return 0;
  switch (op) {
    case 'SUM': return nums.reduce((a, b) => a + b, 0);
    case 'AVG': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'MAX': return Math.max(...nums);
    case 'MIN': return Math.min(...nums);
    default: return 0;
  }
}

function normalizeRange(range: ReportPrintRowRange | null | undefined, maxRows: number): ReportPrintRowRange | null {
  if (!range) return null;
  const start = Math.max(0, Math.min(maxRows - 1, range.start));
  const end = Math.max(start, Math.min(maxRows - 1, range.end));
  return { start, end };
}

function rangeContains(range: ReportPrintRowRange | null | undefined, row: number): boolean {
  return !!range && row >= range.start && row <= range.end;
}

function rowHeight(grid: ReportPrintGrid, row: number): number {
  return grid.rowHeights?.[row] ?? DEFAULT_ROW_HEIGHT;
}

function getBorderStyle(border: boolean | ReportPrintBorder | undefined): ReportPrintBorder | undefined {
  if (!border) return undefined;
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

function resolveToken(marker: '#' | '$', expr: string, ctx: TokenContext): unknown {
  const name = expr.trim();
  const groupAgg = GROUP_AGG_RE.exec(name);
  if (groupAgg) return aggregate(ctx.groupRows, groupAgg[1], groupAgg[2]);
  const pageAgg = PAGE_AGG_RE.exec(name);
  if (pageAgg) return aggregate(ctx.pageRows, pageAgg[1], pageAgg[2]);
  const agg = AGG_RE.exec(name);
  if (agg) return aggregate(ctx.rows, agg[1], agg[2]);
  if (ctx.paramNames.has(name)) return ctx.params[name] ?? '';

  const qr = QRCODE_RE.exec(name);
  if (qr) return { kind: 'qrcode', value: String(getValue(ctx.row, qr[1]) ?? '') } satisfies SpecialToken;
  const barcode = BARCODE_RE.exec(name);
  if (barcode) return { kind: 'barcode', value: String(getValue(ctx.row, barcode[1]) ?? '') } satisfies SpecialToken;

  const target = marker === '#'
    ? (ctx.row ?? ctx.groupRows[0] ?? ctx.pageRows[0] ?? ctx.rows[0] ?? null)
    : ctx.row;
  return target ? (getValue(target, name) ?? '') : '';
}

function hasDetailField(v: unknown, paramNames: Set<string>): boolean {
  if (typeof v !== 'string') return false;
  EXPR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPR_RE.exec(v)) !== null) {
    if (match[1] !== '$') continue;
    const name = match[2].trim();
    if (AGG_RE.test(name) || GROUP_AGG_RE.test(name) || PAGE_AGG_RE.test(name)) continue;
    if (QRCODE_RE.test(name) || BARCODE_RE.test(name)) return true;
    if (paramNames.has(name)) continue;
    return true;
  }
  return false;
}

function substituteText(
  text: string,
  ctx: TokenContext,
  fallbackMarker: '#' | '$' | null = null,
): string | number | boolean | SpecialToken | null {
  const trimmed = text.trim();
  const whole = /^([#$])\{([^}]+)\}$/.exec(trimmed);
  if (whole) {
    const resolved = resolveToken(whole[1] as '#' | '$', whole[2], ctx);
    if (typeof resolved === 'number' || typeof resolved === 'boolean') return resolved;
    if (resolved && typeof resolved === 'object' && 'kind' in resolved) return resolved as SpecialToken;
    return resolved == null ? '' : String(resolved);
  }
  if (fallbackMarker) {
    const resolved = resolveToken(fallbackMarker, text, ctx);
    return resolved == null ? '' : String(resolved);
  }
  EXPR_RE.lastIndex = 0;
  return text.replace(EXPR_RE, (_full, marker: string, expr: string) => {
    const resolved = resolveToken(marker as '#' | '$', expr, ctx);
    if (resolved && typeof resolved === 'object' && 'kind' in resolved) return (resolved as SpecialToken).value;
    return resolved == null ? '' : String(resolved);
  });
}

function substituteCell(cell: ReportPrintCell, ctx: TokenContext, datasetContext?: DatasetContext): ReportPrintCell {
  const effectiveCtx = contextForCell(cell, ctx, datasetContext);
  const next: ReportPrintCell = {
    ...cell,
    ...(cell.s ? { s: { ...cell.s, ...(cell.s.border ? { border: getBorderStyle(cell.s.border) } : {}) } } : {}),
    ...(cell.image ? { image: { ...cell.image } } : {}),
  };

  if (next.formula) {
    const formula = next.formula.startsWith('=') ? next.formula.slice(1) : next.formula;
    EXPR_RE.lastIndex = 0;
    next.formula = `=${formula.replace(EXPR_RE, (_full, marker: string, expr: string) => {
      const resolved = resolveToken(marker as '#' | '$', expr, effectiveCtx);
      if (resolved && typeof resolved === 'object' && 'kind' in resolved) return (resolved as SpecialToken).value;
      return resolved == null ? '' : String(resolved);
    })}`;
    next.kind = next.kind ?? 'formula';
  }
  if (next.image?.src) next.image.src = String(substituteText(next.image.src, effectiveCtx));
  if (typeof next.v !== 'string') return next;

  const substituted = substituteText(next.v, effectiveCtx);
  if (substituted && typeof substituted === 'object' && 'kind' in substituted) {
    next.kind = substituted.kind;
    next.v = substituted.value;
    return next;
  }
  next.v = substituted as string | number | boolean | null;
  if (!next.kind) next.kind = next.formula ? 'formula' : 'text';
  return next;
}

function buildCellsByRow(grid: ReportPrintGrid): Map<number, ReportPrintCell[]> {
  const map = new Map<number, ReportPrintCell[]>();
  for (const cell of grid.cells ?? []) {
    if (!map.has(cell.row)) map.set(cell.row, []);
    map.get(cell.row)!.push(cell);
  }
  return map;
}

function findDetailRange(grid: ReportPrintGrid, cfg: ReportPrintPageConfig, paramNames: Set<string>): ReportPrintRowRange | null {
  if (cfg.detailDirection === 'horizontal') return null;
  const cellsByRow = buildCellsByRow(grid);
  const specialRanges = [
    normalizeRange(cfg.groupHeaderRows, grid.rows),
    normalizeRange(cfg.groupFooterRows, grid.rows),
    normalizeRange(cfg.pageSubtotalRows, grid.rows),
    normalizeRange(cfg.totalRows, grid.rows),
  ];
  const rows: number[] = [];
  for (let row = 0; row < grid.rows; row++) {
    if (specialRanges.some((range) => rangeContains(range, row))) continue;
    if ((cellsByRow.get(row) ?? []).some((cell) => hasDetailField(cell.v, paramNames))) rows.push(row);
  }
  if (!rows.length) return null;
  return { start: rows[0], end: rows[rows.length - 1] };
}

function groupRows(rows: Row[], fields: string[]): Array<{ rows: Row[] }> {
  if (!fields.length || rows.length === 0) return [{ rows }];
  const groups: Array<{ rows: Row[] }> = [];
  let currentKey = '';
  let bucket: Row[] = [];
  for (const row of rows) {
    const key = JSON.stringify(fields.map((field) => getValue(row, field) ?? null));
    if (!bucket.length) {
      currentKey = key;
      bucket = [row];
      continue;
    }
    if (key === currentKey) {
      bucket.push(row);
      continue;
    }
    groups.push({ rows: bucket });
    currentKey = key;
    bucket = [row];
  }
  if (bucket.length) groups.push({ rows: bucket });
  return groups;
}

function renderTemplateRange(
  grid: ReportPrintGrid,
  range: ReportPrintRowRange,
  ctxFactory: (rowIndex: number) => TokenContext,
  datasetContext?: DatasetContext,
): ReportPrintGrid {
  const cellsByRow = buildCellsByRow(grid);
  const cells: ReportPrintCell[] = [];
  const rowHeights: number[] = [];
  let outRow = 0;
  for (let templateRow = range.start; templateRow <= range.end; templateRow++) {
    for (const cell of cellsByRow.get(templateRow) ?? []) {
      cells.push({ ...substituteCell(cell, ctxFactory(templateRow), datasetContext), row: outRow });
    }
    rowHeights[outRow] = rowHeight(grid, templateRow);
    outRow++;
  }
  const merges = (grid.merges ?? [])
    .filter((merge) => merge.row >= range.start && merge.row + merge.rowSpan - 1 <= range.end)
    .map((merge) => ({ ...merge, row: merge.row - range.start }));
  return {
    rows: outRow,
    cols: grid.cols,
    colWidths: grid.colWidths ? [...grid.colWidths] : undefined,
    rowHeights,
    cells,
    ...(merges.length ? { merges } : {}),
  };
}

function appendGridFragments(fragments: ReportPrintGrid[]): ReportPrintGrid {
  const rows = fragments.reduce((sum, fragment) => sum + fragment.rows, 0);
  const cols = fragments.reduce((max, fragment) => Math.max(max, fragment.cols), 0);
  const rowHeights: number[] = [];
  const colWidths: number[] = [];
  const cells: ReportPrintCell[] = [];
  const merges: ReportPrintMerge[] = [];
  let rowOffset = 0;

  for (const fragment of fragments) {
    fragment.colWidths?.forEach((width, index) => {
      if (typeof width === 'number') colWidths[index] = Math.max(colWidths[index] ?? 0, width);
    });
    fragment.rowHeights?.forEach((height, index) => { rowHeights[rowOffset + index] = height; });
    for (const cell of fragment.cells ?? []) cells.push({ ...cell, row: cell.row + rowOffset });
    for (const merge of fragment.merges ?? []) merges.push({ ...merge, row: merge.row + rowOffset });
    rowOffset += fragment.rows;
  }

  return {
    rows,
    cols,
    ...(colWidths.length ? { colWidths } : {}),
    ...(rowHeights.length ? { rowHeights } : {}),
    cells,
    ...(merges.length ? { merges } : {}),
  };
}

function sliceGridRows(grid: ReportPrintGrid, startRow: number, endRow: number): ReportPrintGrid {
  if (endRow < startRow) return { rows: 0, cols: grid.cols, colWidths: grid.colWidths ? [...grid.colWidths] : undefined, cells: [] };
  const cells = grid.cells
    .filter((cell) => cell.row >= startRow && cell.row <= endRow)
    .map((cell) => ({ ...cell, row: cell.row - startRow }));
  const rowHeights = Array.from({ length: endRow - startRow + 1 }, (_v, index) => rowHeight(grid, startRow + index));
  const merges = (grid.merges ?? [])
    .filter((merge) => merge.row >= startRow && merge.row + merge.rowSpan - 1 <= endRow)
    .map((merge) => ({ ...merge, row: merge.row - startRow }));
  return {
    rows: endRow - startRow + 1,
    cols: grid.cols,
    colWidths: grid.colWidths ? [...grid.colWidths] : undefined,
    rowHeights,
    cells,
    ...(merges.length ? { merges } : {}),
  };
}

function buildMerges(grid: ReportPrintGrid, templateRowToOutputRows: number[][]): ReportPrintMerge[] {
  const merges: ReportPrintMerge[] = [];
  for (const merge of grid.merges ?? []) {
    const endTemplateRow = merge.row + merge.rowSpan - 1;
    const counts: number[] = [];
    let valid = true;
    for (let row = merge.row; row <= endTemplateRow; row++) {
      const mapped = templateRowToOutputRows[row] ?? [];
      if (!mapped.length) {
        valid = false;
        break;
      }
      counts.push(mapped.length);
    }
    if (!valid) continue;
    const sameCount = counts.every((count) => count === counts[0]);
    if (sameCount && counts[0] > 1) {
      for (let index = 0; index < counts[0]; index++) {
        const start = templateRowToOutputRows[merge.row]?.[index];
        const end = templateRowToOutputRows[endTemplateRow]?.[index];
        if (start == null || end == null) continue;
        merges.push({ row: start, col: merge.col, rowSpan: end - start + 1, colSpan: merge.colSpan });
      }
      continue;
    }
    const start = templateRowToOutputRows[merge.row]?.[0];
    const end = templateRowToOutputRows[endTemplateRow]?.[0];
    if (start != null && end != null) merges.push({ row: start, col: merge.col, rowSpan: end - start + 1, colSpan: merge.colSpan });
  }
  return merges;
}

function renderRepeatBlockSheet(
  sheet: ReportPrintSheet,
  rows: Row[],
  params: Record<string, unknown>,
  datasetContext: DatasetContext,
): RenderedGridState {
  const grid = sheet.grid;
  const blocks = [...(sheet.repeatBlocks ?? [])].sort((left, right) => left.range.start - right.range.start);
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    if (block.range.start < 0 || block.range.end < block.range.start || block.range.end >= grid.rows) {
      throw new ReportPrintValidationError('PRINT_REPEAT_RANGE_INVALID', `重复块「${block.id}」行范围超出模板网格`);
    }
    const previous = blocks[index - 1];
    if (previous && block.range.start <= previous.range.end) {
      throw new ReportPrintValidationError('PRINT_REPEAT_RANGE_OVERLAP', `重复块「${previous.id}」与「${block.id}」不能重叠`);
    }
  }

  const cellsByRow = buildCellsByRow(grid);
  const paramNames = new Set(Object.keys(params ?? {}));
  const templateRowToOutputRows: number[][] = Array.from({ length: grid.rows }, () => []);
  const outCells: ReportPrintCell[] = [];
  const outRowHeights: number[] = [];
  const rowDetails: Row[][] = [];
  const sheetKey = normalizeDatasetKey(sheet.datasetKey);
  const baseCtx: TokenContext = {
    datasetKey: sheetKey,
    row: rows[0] ?? null,
    rows,
    groupRows: rows,
    pageRows: [],
    params,
    paramNames,
  };
  let outRow = 0;
  let blockIndex = 0;

  const emit = (templateRow: number, ctx: TokenContext, details: Row[]) => {
    for (const cell of cellsByRow.get(templateRow) ?? []) {
      outCells.push({ ...substituteCell(cell, ctx, datasetContext), row: outRow });
    }
    templateRowToOutputRows[templateRow].push(outRow);
    outRowHeights[outRow] = rowHeight(grid, templateRow);
    rowDetails[outRow] = details;
    outRow++;
  };

  for (let templateRow = 0; templateRow < grid.rows; templateRow++) {
    const block = blocks[blockIndex];
    if (!block || templateRow !== block.range.start) {
      emit(templateRow, baseCtx, []);
      continue;
    }
    const blockKey = normalizeDatasetKey(block.datasetKey);
    const blockRows = rowsForDataset(datasetContext, blockKey, baseCtx);
    const records: Array<Row | null> = blockRows.length ? blockRows : [null];
    for (const record of records) {
      const ctx: TokenContext = {
        ...baseCtx,
        datasetKey: blockKey,
        row: record,
        rows: blockRows,
        groupRows: blockRows,
      };
      for (let row = block.range.start; row <= block.range.end; row++) emit(row, ctx, record ? [record] : []);
    }
    templateRow = block.range.end;
    blockIndex++;
  }

  return {
    grid: {
      rows: outRow,
      cols: grid.cols,
      colWidths: grid.colWidths ? [...grid.colWidths] : undefined,
      rowHeights: outRowHeights,
      cells: outCells,
      merges: buildMerges(grid, templateRowToOutputRows),
    },
    rowDetails,
    templateRowToOutputRows,
  };
}

function renderVerticalSheet(
  sheet: ReportPrintSheet,
  rows: Row[],
  params: Record<string, unknown>,
  datasetContext: DatasetContext,
): RenderedGridState {
  if (sheet.repeatBlocks?.length) return renderRepeatBlockSheet(sheet, rows, params, datasetContext);
  const grid = sheet.grid;
  const cfg = sheet.pageConfig ?? {};
  const cellsByRow = buildCellsByRow(grid);
  const paramNames = new Set(Object.keys(params ?? {}));
  const detailRange = findDetailRange(grid, cfg, paramNames);
  const templateRowToOutputRows: number[][] = Array.from({ length: grid.rows }, () => []);
  const outCells: ReportPrintCell[] = [];
  const outRowHeights: number[] = [];
  const rowDetails: Row[][] = [];
  let outRow = 0;

  const baseCtx = { rows, params: params ?? {}, paramNames, datasetKey: normalizeDatasetKey(sheet.datasetKey) };
  const emitTemplateRow = (templateRow: number, ctx: TokenContext, detailRows: Row[] = []) => {
    for (const cell of cellsByRow.get(templateRow) ?? []) outCells.push({ ...substituteCell(cell, ctx, datasetContext), row: outRow });
    templateRowToOutputRows[templateRow].push(outRow);
    outRowHeights[outRow] = rowHeight(grid, templateRow);
    rowDetails[outRow] = detailRows;
    outRow++;
  };

  const emitStaticRows = (start: number, end: number, excludes: Array<ReportPrintRowRange | null>, ctx: TokenContext) => {
    for (let templateRow = start; templateRow <= end; templateRow++) {
      if (excludes.some((range) => rangeContains(range, templateRow))) continue;
      emitTemplateRow(templateRow, ctx);
    }
  };

  const groupHeaderRows = normalizeRange(cfg.groupHeaderRows, grid.rows);
  const groupFooterRows = normalizeRange(cfg.groupFooterRows, grid.rows);
  const pageSubtotalRows = normalizeRange(cfg.pageSubtotalRows, grid.rows);
  const totalRows = normalizeRange(cfg.totalRows, grid.rows);
  const emptyCtx: TokenContext = { ...baseCtx, row: null, groupRows: [], pageRows: [] };

  if (!detailRange) {
    for (let templateRow = 0; templateRow < grid.rows; templateRow++) {
      if (rangeContains(pageSubtotalRows, templateRow)) continue;
      emitTemplateRow(templateRow, emptyCtx);
    }
  } else {
    emitStaticRows(0, detailRange.start - 1, [groupHeaderRows, groupFooterRows, pageSubtotalRows, totalRows], { ...baseCtx, row: rows[0] ?? null, groupRows: rows, pageRows: [] });

    if (cfg.groupByFields?.length && rows.length) {
      for (const group of groupRows(rows, cfg.groupByFields)) {
        const groupCtx: TokenContext = { ...baseCtx, row: group.rows[0] ?? null, groupRows: group.rows, pageRows: [] };
        if (groupHeaderRows) {
          for (let templateRow = groupHeaderRows.start; templateRow <= groupHeaderRows.end; templateRow++) emitTemplateRow(templateRow, groupCtx);
        }
        for (const record of group.rows) {
          const detailCtx: TokenContext = { ...baseCtx, row: record, groupRows: group.rows, pageRows: [] };
          for (let templateRow = detailRange.start; templateRow <= detailRange.end; templateRow++) emitTemplateRow(templateRow, detailCtx, [record]);
        }
        if (groupFooterRows) {
          for (let templateRow = groupFooterRows.start; templateRow <= groupFooterRows.end; templateRow++) emitTemplateRow(templateRow, groupCtx);
        }
      }
    } else {
      const records = rows.length > 0 ? rows : [null];
      for (const record of records) {
        const detailRows = record ? [record] : [];
        const detailCtx: TokenContext = { ...baseCtx, row: record, groupRows: rows, pageRows: [] };
        for (let templateRow = detailRange.start; templateRow <= detailRange.end; templateRow++) emitTemplateRow(templateRow, detailCtx, detailRows);
      }
    }

    emitStaticRows(detailRange.end + 1, grid.rows - 1, [groupHeaderRows, groupFooterRows, pageSubtotalRows, totalRows], { ...baseCtx, row: rows[0] ?? null, groupRows: rows, pageRows: [] });
    if (totalRows) {
      const totalCtx: TokenContext = { ...baseCtx, row: rows[0] ?? null, groupRows: rows, pageRows: [] };
      for (let templateRow = totalRows.start; templateRow <= totalRows.end; templateRow++) emitTemplateRow(templateRow, totalCtx);
    }
  }

  return {
    grid: {
      rows: outRow,
      cols: grid.cols,
      colWidths: grid.colWidths ? [...grid.colWidths] : undefined,
      rowHeights: outRowHeights,
      cells: outCells,
      merges: buildMerges(grid, templateRowToOutputRows),
    },
    rowDetails,
    templateRowToOutputRows,
  };
}

function renderHorizontalSheet(
  sheet: ReportPrintSheet,
  rows: Row[],
  params: Record<string, unknown>,
  datasetContext: DatasetContext,
): RenderedGridState {
  const grid = sheet.grid;
  const paramNames = new Set(Object.keys(params ?? {}));
  const detailCells = grid.cells.filter((cell) => hasDetailField(cell.v, paramNames));
  if (!detailCells.length) {
    const ctx: TokenContext = { datasetKey: normalizeDatasetKey(sheet.datasetKey), row: rows[0] ?? null, rows, groupRows: rows, pageRows: [], params, paramNames };
    return {
      grid: {
        ...grid,
        cells: grid.cells.map((cell) => substituteCell(cell, ctx, datasetContext)),
      },
      rowDetails: Array.from({ length: grid.rows }, () => []),
      templateRowToOutputRows: Array.from({ length: grid.rows }, (_v, index) => [index]),
    };
  }

  const bandStart = Math.min(...detailCells.map((cell) => cell.col));
  const bandEnd = Math.max(...detailCells.map((cell) => cell.col));
  const bandWidth = bandEnd - bandStart + 1;
  const records = rows.length > 0 ? rows : [null];
  const outCells: ReportPrintCell[] = [];
  const outColWidths: number[] = [];
  const outRowHeights = grid.rowHeights ? [...grid.rowHeights] : undefined;

  for (const cell of grid.cells) {
    if (cell.col >= bandStart && cell.col <= bandEnd) {
      for (let index = 0; index < records.length; index++) {
        const ctx: TokenContext = { datasetKey: normalizeDatasetKey(sheet.datasetKey), row: records[index], rows, groupRows: rows, pageRows: [], params, paramNames };
        outCells.push({ ...substituteCell(cell, ctx, datasetContext), col: bandStart + index * bandWidth + (cell.col - bandStart) });
      }
      continue;
    }
    const shift = cell.col > bandEnd ? (records.length - 1) * bandWidth : 0;
    outCells.push({
      ...substituteCell(cell, {
        datasetKey: normalizeDatasetKey(sheet.datasetKey),
        row: rows[0] ?? null,
        rows,
        groupRows: rows,
        pageRows: [],
        params,
        paramNames,
      }, datasetContext),
      col: cell.col + shift,
    });
  }

  grid.colWidths?.forEach((width, col) => {
    if (col < bandStart) outColWidths[col] = width;
    else if (col <= bandEnd) {
      for (let index = 0; index < records.length; index++) outColWidths[bandStart + index * bandWidth + (col - bandStart)] = width;
    } else {
      outColWidths[col + (records.length - 1) * bandWidth] = width;
    }
  });

  const merges: ReportPrintMerge[] = [];
  for (const merge of grid.merges ?? []) {
    if (merge.col >= bandStart && merge.col + merge.colSpan - 1 <= bandEnd) {
      for (let index = 0; index < records.length; index++) merges.push({ ...merge, col: bandStart + index * bandWidth + (merge.col - bandStart) });
      continue;
    }
    const shift = merge.col > bandEnd ? (records.length - 1) * bandWidth : 0;
    merges.push({ ...merge, col: merge.col + shift });
  }

  return {
    grid: {
      rows: grid.rows,
      cols: grid.cols + Math.max(0, records.length - 1) * bandWidth,
      ...(outColWidths.length ? { colWidths: outColWidths } : {}),
      ...(outRowHeights ? { rowHeights: outRowHeights } : {}),
      cells: outCells,
      ...(merges.length ? { merges } : {}),
    },
    rowDetails: Array.from({ length: grid.rows }, () => []),
    templateRowToOutputRows: Array.from({ length: grid.rows }, (_v, index) => [index]),
  };
}

interface CrosstabAggState {
  count: number;
  numericCount: number;
  sum: number;
  min: number | null;
  max: number | null;
}

function createCrosstabAggState(): CrosstabAggState {
  return { count: 0, numericCount: 0, sum: 0, min: null, max: null };
}

function addCrosstabValue(state: CrosstabAggState, value: unknown): void {
  if (value === null || value === undefined || value === '') return;
  state.count++;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return;
  state.numericCount++;
  state.sum += numeric;
  state.min = state.min === null ? numeric : Math.min(state.min, numeric);
  state.max = state.max === null ? numeric : Math.max(state.max, numeric);
}

function crosstabValue(
  state: CrosstabAggState | undefined,
  aggregateName: ReportPrintCrosstabValueField['aggregate'],
  emptyValue: string | number | null | undefined,
): string | number | null {
  if (!state || state.count === 0) return emptyValue ?? null;
  switch (aggregateName) {
    case 'count': return state.count;
    case 'sum': return state.numericCount ? state.sum : (emptyValue ?? null);
    case 'avg': return state.numericCount ? state.sum / state.numericCount : (emptyValue ?? null);
    case 'max': return state.max ?? (emptyValue ?? null);
    case 'min': return state.min ?? (emptyValue ?? null);
  }
}

function dimensionPart(value: unknown, nullLabel: string): { key: string; label: string; rank: number; sortValue: string | number } {
  if (value === null || value === undefined) return { key: '0:null', label: nullLabel, rank: 0, sortValue: '' };
  if (typeof value === 'number') return { key: `1:number:${String(value)}`, label: String(value), rank: 1, sortValue: value };
  if (typeof value === 'boolean') return { key: `2:boolean:${value ? '1' : '0'}`, label: value ? 'true' : 'false', rank: 2, sortValue: value ? 1 : 0 };
  const label = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  return { key: `3:string:${label}`, label, rank: 3, sortValue: label };
}

function dimensionTuple(row: Row, fields: string[], nullLabel: string) {
  const parts = fields.map((field) => dimensionPart(getValue(row, field), nullLabel));
  return {
    key: parts.map((part) => `${part.key.length}:${part.key}`).join('|'),
    labels: parts.map((part) => part.label),
    sortParts: parts.map((part) => ({ rank: part.rank, value: part.sortValue })),
  };
}

function compareDimensionKeys(
  left: { key: string; sortParts: Array<{ rank: number; value: string | number }> },
  right: { key: string; sortParts: Array<{ rank: number; value: string | number }> },
): number {
  for (let index = 0; index < Math.max(left.sortParts.length, right.sortParts.length); index += 1) {
    const leftPart = left.sortParts[index];
    const rightPart = right.sortParts[index];
    if (!leftPart) return -1;
    if (!rightPart) return 1;
    if (leftPart.rank !== rightPart.rank) return leftPart.rank - rightPart.rank;
    if (leftPart.value !== rightPart.value) return leftPart.value < rightPart.value ? -1 : 1;
  }
  return left.key === right.key ? 0 : (left.key < right.key ? -1 : 1);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function crosstabValueFields(config: ReportPrintCrosstabConfig): ReportPrintCrosstabValueField[] {
  if (config.valueFields?.length) return config.valueFields;
  if (config.valueField && config.aggregate) {
    return [{ field: config.valueField, aggregate: config.aggregate, label: config.valueField }];
  }
  throw new ReportPrintValidationError('PRINT_CROSSTAB_VALUES_REQUIRED', '交叉表至少需要一个值字段');
}

function cloneCellStyle(cell: ReportPrintCell | undefined): ReportPrintCell['s'] {
  if (!cell?.s) return undefined;
  return {
    ...cell.s,
    ...(cell.s.border && typeof cell.s.border === 'object'
      ? {
          border: {
            ...(cell.s.border.top ? { top: { ...cell.s.border.top } } : {}),
            ...(cell.s.border.right ? { right: { ...cell.s.border.right } } : {}),
            ...(cell.s.border.bottom ? { bottom: { ...cell.s.border.bottom } } : {}),
            ...(cell.s.border.left ? { left: { ...cell.s.border.left } } : {}),
          },
        }
      : {}),
  };
}

function templateCellAt(grid: ReportPrintGrid, row: number, col: number): ReportPrintCell | undefined {
  return grid.cells.find((cell) => cell.row === row && cell.col === col)
    ?? grid.cells.filter((cell) => cell.row === row).sort((left, right) => right.col - left.col)[0];
}

function renderCrosstabSheet(
  sheet: ReportPrintSheet,
  rows: Row[],
  params: Record<string, unknown>,
  datasetContext: DatasetContext,
  budgetOverride?: ReportPrintRenderOptions['crosstabBudget'],
): RenderedGridState {
  const config = sheet.pageConfig?.crosstab;
  if (!config) {
    throw new ReportPrintValidationError('PRINT_CROSSTAB_CONFIG_REQUIRED', `Sheet「${sheet.name}」缺少交叉表配置`);
  }
  const valueFields = crosstabValueFields(config);
  const nullLabel = config.nullLabel ?? '(空)';
  const budget = { ...DEFAULT_PRINT_CROSSTAB_BUDGET, ...(budgetOverride ?? {}) };
  const rowDimensions = new Map<string, ReturnType<typeof dimensionTuple>>();
  const columnDimensions = new Map<string, ReturnType<typeof dimensionTuple>>();
  const matrix = new Map<string, Map<string, CrosstabAggState[]>>();
  const rowTotals = new Map<string, CrosstabAggState[]>();
  const columnTotals = new Map<string, CrosstabAggState[]>();
  const grandTotals = valueFields.map(() => createCrosstabAggState());
  let dimensionBytes = 0;

  for (const row of rows) {
    const rowDimension = dimensionTuple(row, config.rowFields, nullLabel);
    const columnDimension = dimensionTuple(row, config.columnFields, nullLabel);
    if (!rowDimensions.has(rowDimension.key)) {
      rowDimensions.set(rowDimension.key, rowDimension);
      dimensionBytes += utf8ByteLength(rowDimension.key) + utf8ByteLength(rowDimension.labels.join(''));
    }
    if (!columnDimensions.has(columnDimension.key)) {
      columnDimensions.set(columnDimension.key, columnDimension);
      dimensionBytes += utf8ByteLength(columnDimension.key) + utf8ByteLength(columnDimension.labels.join(''));
      const dynamicColumns = columnDimensions.size * valueFields.length + (config.showRowTotals ? valueFields.length : 0);
      if (dynamicColumns > budget.maxDynamicColumns) {
        throw new ReportPrintValidationError(
          'PRINT_CROSSTAB_COLUMNS_EXCEEDED',
          `交叉表动态列数 ${dynamicColumns} 超过上限 ${budget.maxDynamicColumns}`,
        );
      }
    }
    if (dimensionBytes > budget.maxBytes) {
      throw new ReportPrintValidationError('PRINT_CROSSTAB_BYTES_EXCEEDED', `交叉表维度数据超过 ${budget.maxBytes} 字节上限`);
    }
    const projectedColumns = config.rowFields.length
      + columnDimensions.size * valueFields.length
      + (config.showRowTotals ? valueFields.length : 0);
    const projectedRows = config.columnFields.length + 1
      + rowDimensions.size
      + (config.showColumnTotals ? 1 : 0);
    const projectedCells = Math.max(projectedRows, 1) * Math.max(projectedColumns, 1);
    if (projectedCells > budget.maxCells) {
      throw new ReportPrintValidationError('PRINT_CROSSTAB_CELLS_EXCEEDED', `交叉表单元格数 ${projectedCells} 超过上限 ${budget.maxCells}`);
    }
    if (dimensionBytes + projectedCells * 96 > budget.maxBytes) {
      throw new ReportPrintValidationError(
        'PRINT_CROSSTAB_BYTES_EXCEEDED',
        `交叉表预计大小 ${dimensionBytes + projectedCells * 96} 字节超过上限 ${budget.maxBytes}`,
      );
    }
    let rowMap = matrix.get(rowDimension.key);
    if (!rowMap) {
      rowMap = new Map();
      matrix.set(rowDimension.key, rowMap);
    }
    let states = rowMap.get(columnDimension.key);
    if (!states) {
      states = valueFields.map(() => createCrosstabAggState());
      rowMap.set(columnDimension.key, states);
    }
    let rowTotalStates = rowTotals.get(rowDimension.key);
    if (!rowTotalStates) {
      rowTotalStates = valueFields.map(() => createCrosstabAggState());
      rowTotals.set(rowDimension.key, rowTotalStates);
    }
    let columnTotalStates = columnTotals.get(columnDimension.key);
    if (!columnTotalStates) {
      columnTotalStates = valueFields.map(() => createCrosstabAggState());
      columnTotals.set(columnDimension.key, columnTotalStates);
    }
    valueFields.forEach((valueField, index) => {
      const value = getValue(row, valueField.field);
      addCrosstabValue(states![index]!, value);
      addCrosstabValue(rowTotalStates![index]!, value);
      addCrosstabValue(columnTotalStates![index]!, value);
      addCrosstabValue(grandTotals[index]!, value);
    });
  }

  const sortedRows = [...rowDimensions.values()].sort(compareDimensionKeys);
  const sortedColumns = [...columnDimensions.values()].sort(compareDimensionKeys);
  const headerDepth = config.columnFields.length + 1;
  const totalColumnCount = config.showRowTotals ? valueFields.length : 0;
  const tableColumns = config.rowFields.length + sortedColumns.length * valueFields.length + totalColumnCount;
  const tableRows = headerDepth + sortedRows.length + (config.showColumnTotals ? 1 : 0);
  const estimatedCells = Math.max(tableRows, 1) * Math.max(tableColumns, 1);
  const estimatedBytes = dimensionBytes + estimatedCells * 96;
  if (estimatedCells > budget.maxCells) {
    throw new ReportPrintValidationError('PRINT_CROSSTAB_CELLS_EXCEEDED', `交叉表单元格数 ${estimatedCells} 超过上限 ${budget.maxCells}`);
  }
  if (estimatedBytes > budget.maxBytes) {
    throw new ReportPrintValidationError('PRINT_CROSSTAB_BYTES_EXCEEDED', `交叉表预计大小 ${estimatedBytes} 字节超过上限 ${budget.maxBytes}`);
  }

  const grid = sheet.grid;
  const headerRow = config.headerRow ?? 0;
  const dataRow = config.dataRow ?? Math.min(headerRow + 1, Math.max(grid.rows - 1, 0));
  const totalRow = config.totalRow ?? dataRow;
  const startColumn = config.startColumn ?? 0;
  for (const [label, row] of [['表头', headerRow], ['数据', dataRow], ['总计', totalRow]] as const) {
    if (row < 0 || row >= grid.rows) {
      throw new ReportPrintValidationError('PRINT_CROSSTAB_TEMPLATE_ROW_INVALID', `交叉表${label}模板行 ${row} 超出网格`);
    }
  }
  const templateRows = new Set([headerRow, dataRow, totalRow]);
  const prefixRows = Array.from({ length: headerRow }, (_value, index) => index).filter((row) => !templateRows.has(row));
  const lastTemplateRow = Math.max(headerRow, dataRow, totalRow);
  const suffixRows = Array.from({ length: Math.max(0, grid.rows - lastTemplateRow - 1) }, (_value, index) => lastTemplateRow + index + 1);
  const outputRows = prefixRows.length + tableRows + suffixRows.length;
  const outputColumns = Math.max(grid.cols, startColumn + tableColumns);
  const cells: ReportPrintCell[] = [];
  const merges: ReportPrintMerge[] = [];
  const rowHeights: number[] = [];
  const colWidths = [...(grid.colWidths ?? [])];
  const paramNames = new Set(Object.keys(params));
  const baseCtx: TokenContext = {
    datasetKey: normalizeDatasetKey(sheet.datasetKey),
    row: rows[0] ?? null,
    rows,
    groupRows: rows,
    pageRows: [],
    params,
    paramNames,
  };
  const copyStaticRow = (templateRow: number, outputRow: number) => {
    for (const cell of grid.cells.filter((item) => item.row === templateRow)) {
      cells.push({ ...substituteCell(cell, baseCtx, datasetContext), row: outputRow });
    }
    rowHeights[outputRow] = rowHeight(grid, templateRow);
    for (const merge of grid.merges ?? []) {
      if (merge.row === templateRow && merge.rowSpan === 1) merges.push({ ...merge, row: outputRow });
    }
  };
  prefixRows.forEach((templateRow, index) => copyStaticRow(templateRow, index));
  const tableStartRow = prefixRows.length;
  const headerStyle = (col: number) => cloneCellStyle(templateCellAt(grid, headerRow, col));
  const dataStyle = (col: number) => cloneCellStyle(templateCellAt(grid, dataRow, col));
  const totalStyle = (col: number) => cloneCellStyle(templateCellAt(grid, totalRow, col));
  const addCell = (row: number, col: number, value: ReportPrintCell['v'], style?: ReportPrintCell['s']) => {
    cells.push({ row, col, v: value, ...(style ? { s: style } : {}) });
  };

  config.rowFields.forEach((field, index) => {
    addCell(tableStartRow, startColumn + index, field, headerStyle(startColumn + index));
    if (headerDepth > 1) merges.push({ row: tableStartRow, col: startColumn + index, rowSpan: headerDepth, colSpan: 1 });
    colWidths[startColumn + index] = grid.colWidths?.[startColumn + index] ?? 120;
  });

  const dynamicStart = startColumn + config.rowFields.length;
  for (let level = 0; level < config.columnFields.length; level += 1) {
    let groupStart = 0;
    while (groupStart < sortedColumns.length) {
      const dimension = sortedColumns[groupStart]!;
      const prefix = dimension.sortParts.slice(0, level + 1);
      let groupEnd = groupStart + 1;
      while (
        groupEnd < sortedColumns.length
        && sortedColumns[groupEnd]!.sortParts.slice(0, level + 1)
          .every((part, index) => part.rank === prefix[index]?.rank && part.value === prefix[index]?.value)
      ) {
        groupEnd += 1;
      }
      const col = dynamicStart + groupStart * valueFields.length;
      const colSpan = (groupEnd - groupStart) * valueFields.length;
      addCell(tableStartRow + level, col, dimension.labels[level] ?? '', headerStyle(dynamicStart));
      if (colSpan > 1) merges.push({ row: tableStartRow + level, col, rowSpan: 1, colSpan });
      groupStart = groupEnd;
    }
  }
  sortedColumns.forEach((_column, columnIndex) => {
    const leafStart = dynamicStart + columnIndex * valueFields.length;
    valueFields.forEach((valueField, valueIndex) => {
      const col = leafStart + valueIndex;
      addCell(tableStartRow + headerDepth - 1, col, valueField.label ?? valueField.field, headerStyle(dynamicStart));
      colWidths[col] = grid.colWidths?.[dynamicStart] ?? 96;
    });
  });

  if (config.showRowTotals) {
    const totalStart = dynamicStart + sortedColumns.length * valueFields.length;
    valueFields.forEach((valueField, index) => {
      addCell(tableStartRow, totalStart + index, `${valueField.label ?? valueField.field} 合计`, headerStyle(dynamicStart));
      if (headerDepth > 1) merges.push({ row: tableStartRow, col: totalStart + index, rowSpan: headerDepth, colSpan: 1 });
      colWidths[totalStart + index] = grid.colWidths?.[dynamicStart] ?? 96;
    });
  }

  sortedRows.forEach((rowDimension, rowIndex) => {
    const outputRow = tableStartRow + headerDepth + rowIndex;
    rowHeights[outputRow] = rowHeight(grid, dataRow);
    rowDimension.labels.forEach((label, index) => addCell(outputRow, startColumn + index, label, dataStyle(startColumn + index)));
    sortedColumns.forEach((columnDimension, columnIndex) => {
      const states = matrix.get(rowDimension.key)?.get(columnDimension.key);
      valueFields.forEach((valueField, valueIndex) => {
        const col = dynamicStart + columnIndex * valueFields.length + valueIndex;
        addCell(outputRow, col, crosstabValue(states?.[valueIndex], valueField.aggregate, config.emptyValue), dataStyle(dynamicStart));
      });
    });
    if (config.showRowTotals) {
      const states = rowTotals.get(rowDimension.key);
      const totalStart = dynamicStart + sortedColumns.length * valueFields.length;
      valueFields.forEach((valueField, valueIndex) => {
        addCell(outputRow, totalStart + valueIndex, crosstabValue(states?.[valueIndex], valueField.aggregate, config.emptyValue), totalStyle(dynamicStart));
      });
    }
  });

  if (config.showColumnTotals) {
    const outputRow = tableStartRow + headerDepth + sortedRows.length;
    rowHeights[outputRow] = rowHeight(grid, totalRow);
    addCell(outputRow, startColumn, '合计', totalStyle(startColumn));
    if (config.rowFields.length > 1) merges.push({ row: outputRow, col: startColumn, rowSpan: 1, colSpan: config.rowFields.length });
    sortedColumns.forEach((columnDimension, columnIndex) => {
      const states = columnTotals.get(columnDimension.key);
      valueFields.forEach((valueField, valueIndex) => {
        const col = dynamicStart + columnIndex * valueFields.length + valueIndex;
        addCell(outputRow, col, crosstabValue(states?.[valueIndex], valueField.aggregate, config.emptyValue), totalStyle(dynamicStart));
      });
    });
    if (config.showRowTotals) {
      const totalStart = dynamicStart + sortedColumns.length * valueFields.length;
      valueFields.forEach((valueField, valueIndex) => {
        addCell(outputRow, totalStart + valueIndex, crosstabValue(grandTotals[valueIndex], valueField.aggregate, config.emptyValue), totalStyle(dynamicStart));
      });
    }
  }

  for (let index = 0; index < headerDepth; index++) rowHeights[tableStartRow + index] = rowHeight(grid, headerRow);
  suffixRows.forEach((templateRow, index) => copyStaticRow(templateRow, tableStartRow + tableRows + index));
  const templateRowToOutputRows: number[][] = Array.from({ length: grid.rows }, () => []);
  templateRowToOutputRows[headerRow] = Array.from({ length: headerDepth }, (_value, index) => tableStartRow + index);
  templateRowToOutputRows[dataRow] = sortedRows.map((_value, index) => tableStartRow + headerDepth + index);
  if (config.showColumnTotals) templateRowToOutputRows[totalRow] = [tableStartRow + headerDepth + sortedRows.length];
  return {
    grid: {
      rows: outputRows,
      cols: outputColumns,
      colWidths,
      rowHeights,
      cells,
      ...(merges.length ? { merges } : {}),
    },
    rowDetails: Array.from({ length: outputRows }, () => []),
    templateRowToOutputRows,
  };
}

function pageContentHeightPx(config: ReportPrintPageConfig, headerRowsHeight = 0): number {
  const paper = config.paper ?? 'A4';
  const [paperWidth, paperHeight] = PAPER_SIZE_MM[paper] ?? PAPER_SIZE_MM.A4;
  const usableHeightMm = (config.orientation === 'landscape' ? paperWidth : paperHeight) - (config.margin?.top ?? 12) - (config.margin?.bottom ?? 12);
  const bandPaddingPx = (config.header ? 24 : 0) + (config.footer ? 24 : 0) + headerRowsHeight;
  return Math.max(0, usableHeightMm * MM_TO_PX - bandPaddingPx);
}

function estimatedWrappedLineCount(value: string, width: number, fontSize: number): number {
  const availableWidth = Math.max(fontSize, width - 12);
  return value.split(/\r?\n/).reduce((total, line) => {
    let lineWidth = 0;
    for (const char of line) {
      lineWidth += /[\u2e80-\u9fff\uf900-\ufaff\uff01-\uff60]/u.test(char) ? fontSize : fontSize * 0.55;
    }
    return total + Math.max(1, Math.ceil(lineWidth / availableWidth));
  }, 0);
}

function adjustWrappedRowHeights(grid: ReportPrintGrid, config: ReportPrintPageConfig): void {
  const heights = Array.from({ length: grid.rows }, (_, row) => grid.rowHeights?.[row] ?? DEFAULT_ROW_HEIGHT);
  const widths = Array.from({ length: grid.cols }, (_, col) => grid.colWidths?.[col] ?? 96);
  const [paperWidth, paperHeight] = PAPER_SIZE_MM[config.paper ?? 'A4'] ?? PAPER_SIZE_MM.A4;
  const orientedWidth = config.orientation === 'landscape' ? paperHeight : paperWidth;
  const availableWidth = Math.max(1, (orientedWidth - (config.margin?.left ?? 12) - (config.margin?.right ?? 12)) * MM_TO_PX);
  const gridWidth = widths.reduce((sum, width) => sum + width, 0);
  const widthScale = gridWidth > availableWidth ? availableWidth / gridWidth : 1;
  const merges = grid.merges ?? [];
  for (const cell of grid.cells) {
    if (!cell.s?.wrap || cell.v == null || cell.kind === 'image' || cell.kind === 'qrcode' || cell.kind === 'barcode') continue;
    const merge = findPrintMerge(cell.row, cell.col, merges);
    const colSpan = merge?.colSpan ?? 1;
    const rowSpan = merge?.rowSpan ?? 1;
    const width = widths.slice(cell.col, cell.col + colSpan).reduce((sum, value) => sum + value, 0) * widthScale;
    const fontSize = cell.s.fontSize ?? 12;
    const requiredHeight = Math.ceil(estimatedWrappedLineCount(String(cell.v), width, fontSize) * fontSize * 1.35 + 8);
    if (requiredHeight > 4096) {
      throw new ReportPrintValidationError('PRINT_ROW_HEIGHT_LIMIT', `单元格 R${cell.row + 1}C${cell.col + 1} 自动换行后的高度超过 4096px`);
    }
    const currentHeight = heights.slice(cell.row, cell.row + rowSpan).reduce((sum, value) => sum + value, 0);
    if (requiredHeight > currentHeight) heights[cell.row + rowSpan - 1] += requiredHeight - currentHeight;
  }
  grid.rowHeights = heights;
}

function paginateSheet(
  sheet: ReportPrintSheet,
  rendered: RenderedGridState,
  rows: Row[],
  params: Record<string, unknown>,
  datasetContext: DatasetContext,
): ReportPrintSheetRenderResult {
  const grid = rendered.grid;
  const cfg = sheet.pageConfig ?? {};
  if (grid.rows === 0) {
    return { id: sheet.id, name: sheet.name, grid, pageConfig: cfg, pages: [], rowCount: 0 };
  }

  const headerRange = normalizeRange(cfg.repeatHeaderRows, sheet.grid.rows);
  const headerStart = headerRange ? rendered.templateRowToOutputRows[headerRange.start]?.[0] ?? 0 : null;
  const headerEndRows = headerRange ? rendered.templateRowToOutputRows[headerRange.end] ?? [] : [];
  const headerEnd = headerRange ? headerEndRows[headerEndRows.length - 1] ?? headerStart ?? 0 : null;
  const headerFragment = headerStart != null && headerEnd != null ? sliceGridRows(grid, headerStart, headerEnd) : null;
  const bodyStart = headerEnd != null ? headerEnd + 1 : 0;
  const headerRowsHeight = headerFragment?.rowHeights?.reduce((sum, value) => sum + (value ?? DEFAULT_ROW_HEIGHT), 0) ?? 0;
  const heightLimit = cfg.calculateRowsPerPage || !cfg.rowsPerPage ? pageContentHeightPx(cfg, headerRowsHeight) : Number.POSITIVE_INFINITY;
  const rowLimit = cfg.rowsPerPage ?? Number.POSITIVE_INFINITY;
  const pageBreaks = new Set((cfg.pageBreaks ?? []).filter((value) => value > 0));
  const pages: ReportPrintRenderPage[] = [];
  let cursor = bodyStart;
  let logicalRows = 0;
  let pageNumber = 1;

  while (cursor < grid.rows || (cursor === bodyStart && bodyStart === grid.rows)) {
    const bodyRows: number[] = [];
    const pageRows: Row[] = [];
    let usedHeight = 0;

    while (cursor < grid.rows) {
      const nextHeight = rowHeight(grid, cursor);
      const exceedsRowLimit = bodyRows.length > 0 && bodyRows.length >= rowLimit;
      const exceedsHeight = bodyRows.length > 0 && usedHeight + nextHeight > heightLimit;
      if (exceedsRowLimit || exceedsHeight) break;
      bodyRows.push(cursor);
      usedHeight += nextHeight;
      for (const row of rendered.rowDetails[cursor] ?? []) pageRows.push(row);
      logicalRows++;
      cursor++;
      if (pageBreaks.has(logicalRows)) break;
    }

    if (!bodyRows.length && cursor < grid.rows) {
      bodyRows.push(cursor);
      for (const row of rendered.rowDetails[cursor] ?? []) pageRows.push(row);
      logicalRows++;
      cursor++;
    }

    const fragments: ReportPrintGrid[] = [];
    if (headerFragment) fragments.push(pageNumber === 1 ? sliceGridRows(grid, headerStart!, headerEnd!) : headerFragment);
    if (bodyRows.length) fragments.push(sliceGridRows(grid, bodyRows[0]!, bodyRows[bodyRows.length - 1]!));

    const pageSubtotalRows = normalizeRange(cfg.pageSubtotalRows, sheet.grid.rows);
    if (pageSubtotalRows && pageRows.length) {
      fragments.push(renderTemplateRange(sheet.grid, pageSubtotalRows, () => ({
        row: pageRows[0] ?? null,
        rows,
        groupRows: pageRows,
        pageRows,
        params,
        paramNames: new Set(Object.keys(params ?? {})),
      }), datasetContext));
    }

    const pageGrid = appendGridFragments(fragments.length ? fragments : [{ rows: 1, cols: grid.cols, cells: [], colWidths: grid.colWidths, rowHeights: [DEFAULT_ROW_HEIGHT] }]);
    pages.push({
      sheetId: sheet.id,
      sheetName: sheet.name,
      pageNumber,
      totalPages: 0,
      grid: pageGrid,
      pageConfig: cfg,
    });

    if (cursor >= grid.rows) break;
    pageNumber++;
  }

  return {
    id: sheet.id,
    name: sheet.name,
    grid,
    pageConfig: cfg,
    pages,
    rowCount: grid.rows,
  };
}

function embedSubreportGrid(
  grid: ReportPrintGrid,
  anchorRow: number,
  anchorCol: number,
  subGrid: ReportPrintGrid,
): ReportPrintGrid {
  const extraRows = Math.max(0, subGrid.rows - 1);
  for (const merge of grid.merges ?? []) {
    const mergeEnd = merge.row + merge.rowSpan - 1;
    if (merge.row < anchorRow && mergeEnd >= anchorRow) {
      throw new ReportPrintValidationError('PRINT_SUBREPORT_MERGE_CONFLICT', `子报表单元格第 ${anchorRow + 1} 行与跨行合并区域冲突`);
    }
  }
  const conflictingCell = grid.cells.find((cell) =>
    cell.row === anchorRow
    && cell.col > anchorCol
    && cell.col < anchorCol + subGrid.cols);
  if (conflictingCell) {
    throw new ReportPrintValidationError(
      'PRINT_SUBREPORT_CELL_CONFLICT',
      `子报表区域与单元格 R${conflictingCell.row + 1}C${conflictingCell.col + 1} 冲突，请先合并或清空目标区域`,
    );
  }
  const cells = grid.cells
    .filter((cell) => !(cell.row === anchorRow && cell.col === anchorCol))
    .map((cell) => cell.row > anchorRow ? { ...cell, row: cell.row + extraRows } : { ...cell });
  for (const cell of subGrid.cells) {
    cells.push({
      ...cell,
      row: anchorRow + cell.row,
      col: anchorCol + cell.col,
      ...(cell.s ? { s: cloneCellStyle(cell) } : {}),
      ...(cell.image ? { image: { ...cell.image } } : {}),
      subreport: undefined,
    });
  }
  const merges: ReportPrintMerge[] = [];
  for (const merge of grid.merges ?? []) {
    if (merge.row === anchorRow && merge.col === anchorCol) continue;
    merges.push(merge.row > anchorRow ? { ...merge, row: merge.row + extraRows } : { ...merge });
  }
  for (const merge of subGrid.merges ?? []) {
    merges.push({ ...merge, row: anchorRow + merge.row, col: anchorCol + merge.col });
  }
  const rowHeights = [...(grid.rowHeights ?? [])];
  if (extraRows > 0) rowHeights.splice(anchorRow + 1, 0, ...Array.from({ length: extraRows }, () => DEFAULT_ROW_HEIGHT));
  subGrid.rowHeights?.forEach((height, index) => {
    if (typeof height === 'number') rowHeights[anchorRow + index] = height;
  });
  const colWidths = [...(grid.colWidths ?? [])];
  subGrid.colWidths?.forEach((width, index) => {
    const col = anchorCol + index;
    if (typeof width === 'number') colWidths[col] = Math.max(colWidths[col] ?? 0, width);
  });
  return {
    rows: grid.rows + extraRows,
    cols: Math.max(grid.cols, anchorCol + subGrid.cols),
    ...(colWidths.length ? { colWidths } : {}),
    ...(rowHeights.length ? { rowHeights } : {}),
    cells,
    ...(merges.length ? { merges } : {}),
  };
}

function shiftRowRangeAfterInsertions(
  range: ReportPrintRowRange,
  insertions: Array<{ row: number; count: number }>,
): ReportPrintRowRange {
  return {
    start: range.start + insertions
      .filter((item) => item.row < range.start)
      .reduce((sum, item) => sum + item.count, 0),
    end: range.end + insertions
      .filter((item) => item.row <= range.end)
      .reduce((sum, item) => sum + item.count, 0),
  };
}

function shiftRowIndexAfterInsertions(
  row: number | undefined,
  insertions: Array<{ row: number; count: number }>,
): number | undefined {
  if (row == null) return undefined;
  return row + insertions
    .filter((item) => item.row < row)
    .reduce((sum, item) => sum + item.count, 0);
}

function applyResolvedSubreports(sheet: ReportPrintSheet, options?: ReportPrintRenderOptions): ReportPrintSheet {
  const matches = (options?.subreports ?? [])
    .filter((item) => item.sheetId === sheet.id)
    .sort((left, right) => left.row - right.row || left.col - right.col);
  if (!matches.length) return sheet;
  let grid = sheet.grid;
  const insertedRows: Array<{ row: number; count: number }> = [];
  for (const match of matches) {
    if (match.result.sheets.length !== 1) {
      throw new ReportPrintValidationError('PRINT_SUBREPORT_MULTISHEET_UNSUPPORTED', '单元格子报表必须只包含一个 Sheet');
    }
    const anchorRow = match.row + insertedRows
      .filter((item) => item.row < match.row)
      .reduce((sum, item) => sum + item.count, 0);
    const anchor = grid.cells.find((cell) =>
      cell.row === anchorRow
      && cell.col === match.col
      && cell.subreport?.templateId === match.templateId);
    if (!anchor) {
      throw new ReportPrintValidationError('PRINT_SUBREPORT_ANCHOR_MISSING', `找不到子报表模板 ${match.templateId} 的锚点单元格`);
    }
    const subGrid = match.result.sheets[0]?.grid;
    if (!subGrid) continue;
    grid = embedSubreportGrid(grid, anchorRow, match.col, subGrid);
    insertedRows.push({ row: match.row, count: Math.max(0, subGrid.rows - 1) });
  }
  const shiftRange = (range: ReportPrintRowRange | null | undefined) =>
    range ? shiftRowRangeAfterInsertions(range, insertedRows) : range;
  const pageConfig = sheet.pageConfig
    ? {
        ...sheet.pageConfig,
        repeatHeaderRows: shiftRange(sheet.pageConfig.repeatHeaderRows),
        groupHeaderRows: shiftRange(sheet.pageConfig.groupHeaderRows),
        groupFooterRows: shiftRange(sheet.pageConfig.groupFooterRows),
        pageSubtotalRows: shiftRange(sheet.pageConfig.pageSubtotalRows),
        totalRows: shiftRange(sheet.pageConfig.totalRows),
        ...(sheet.pageConfig.crosstab
          ? {
              crosstab: {
                ...sheet.pageConfig.crosstab,
                headerRow: shiftRowIndexAfterInsertions(sheet.pageConfig.crosstab.headerRow, insertedRows),
                dataRow: shiftRowIndexAfterInsertions(sheet.pageConfig.crosstab.dataRow, insertedRows),
                totalRow: shiftRowIndexAfterInsertions(sheet.pageConfig.crosstab.totalRow, insertedRows),
              },
            }
          : {}),
      }
    : undefined;
  const repeatBlocks = sheet.repeatBlocks?.map((block) => ({
    ...block,
    range: shiftRowRangeAfterInsertions(block.range, insertedRows),
  }));
  return {
    ...sheet,
    grid,
    ...(pageConfig ? { pageConfig } : {}),
    ...(repeatBlocks?.length ? { repeatBlocks } : {}),
  };
}

function normalizeSheets(
  content: ReportPrintContent | undefined,
  pageConfig: ReportPrintPageConfig,
  options?: ReportPrintRenderOptions,
): ReportPrintSheet[] {
  if (content?.sheets?.length) {
    return content.sheets.map((rawSheet, index) => {
      const sheet = applyResolvedSubreports(rawSheet, options);
      return {
      id: sheet.id || `sheet-${String(index + 1).padStart(2, '0')}`,
      name: sheet.name || `Sheet${index + 1}`,
      ...(sheet.datasetKey ? { datasetKey: sheet.datasetKey } : {}),
      grid: sheet.grid,
      pageConfig: { ...pageConfig, ...(sheet.pageConfig ?? {}) },
      ...(sheet.repeatBlocks?.length ? { repeatBlocks: sheet.repeatBlocks } : {}),
      };
    });
  }
  if (content?.grid) {
    return [applyResolvedSubreports({
      id: 'sheet-01',
      name: 'Sheet1',
      grid: content.grid,
      pageConfig: { ...pageConfig },
    }, options)];
  }
  return [{
    id: 'sheet-01',
    name: 'Sheet1',
    grid: { rows: 1, cols: 1, cells: [] },
    pageConfig: { ...pageConfig },
  }];
}

export function renderPrintContent(
  name: string,
  content: ReportPrintContent | undefined,
  rows: Row[],
  params: Record<string, unknown> = {},
  pageConfig: ReportPrintPageConfig = {},
  options?: ReportPrintRenderOptions,
): ReportPrintRenderResult {
  const data = Array.isArray(rows) ? rows : [];
  const datasetContext = buildDatasetContext(data, options);
  const sheets = normalizeSheets(content, pageConfig, options).map((sheet) => {
    const sheetRows = rowsForDataset(datasetContext, sheet.datasetKey);
    let rendered: RenderedGridState;
    if (sheet.pageConfig?.detailDirection === 'horizontal') {
      rendered = renderHorizontalSheet(sheet, sheetRows, params, datasetContext);
    } else if (sheet.pageConfig?.detailDirection === 'crosstab') {
      rendered = renderCrosstabSheet(sheet, sheetRows, params, datasetContext, options?.crosstabBudget);
    } else {
      rendered = renderVerticalSheet(sheet, sheetRows, params, datasetContext);
    }
    adjustWrappedRowHeights(rendered.grid, sheet.pageConfig ?? {});
    return paginateSheet(sheet, rendered, sheetRows, params, datasetContext);
  });

  const flatPages = sheets.flatMap((sheet) => sheet.pages);
  const totalPages = flatPages.length;
  const date = options?.renderedAt ?? '';
  flatPages.forEach((page, index) => {
    page.pageNumber = index + 1;
    page.totalPages = totalPages;
    page.headerText = resolvePrintBandText(page.pageConfig.header, params, { page: page.pageNumber, pages: totalPages, date });
    page.footerText = resolvePrintBandText(page.pageConfig.footer, params, { page: page.pageNumber, pages: totalPages, date });
  });

  const firstSheet = sheets[0] ?? {
    id: 'sheet-01',
    name: 'Sheet1',
    grid: { rows: 1, cols: 1, cells: [] },
    pageConfig: pageConfig ?? {},
    pages: [],
    rowCount: 0,
  };

  return {
    name,
    grid: firstSheet.grid,
    pageConfig: firstSheet.pageConfig,
    pages: flatPages,
    sheets,
  };
}

/** 解析页眉/页脚占位符：${param} 与 {page}/{pages}/{date} */
export function resolvePrintBandText(
  text: string | undefined,
  params: Record<string, unknown>,
  ctx: { page?: number; pages?: number; date?: string } = {},
): string {
  if (!text) return '';
  return text
    .replace(/\$\{(\w+)\}/g, (_m, key: string) => String(params?.[key] ?? ''))
    .replace(/\{page\}/g, String(ctx.page ?? ''))
    .replace(/\{pages\}/g, String(ctx.pages ?? ''))
    .replace(/\{date\}/g, ctx.date ?? '');
}
