/**
 * 类 Excel 打印报表 —— 纯函数填充/分页引擎（前后端共用）。
 *
 * 表达式：
 *   ${field} / #{field}         明细 / 标量
 *   ${SUM(field)}               总计
 *   ${GROUP_SUM(field)}         组小计
 *   ${PAGE_SUM(field)}          页小计
 *   ${QRCODE(field)}            二维码单元格
 *   ${CODE128(field)}           Code128 条码单元格
 */
import type {
  ReportPrintBorder,
  ReportPrintCell,
  ReportPrintContent,
  ReportPrintGrid,
  ReportPrintMerge,
  ReportPrintPageConfig,
  ReportPrintRenderPage,
  ReportPrintRenderResult,
  ReportPrintRowRange,
  ReportPrintSheet,
  ReportPrintSheetRenderResult,
} from './types';

type Row = Record<string, unknown>;

const AGG_RE = /^(SUM|COUNT|AVG|MAX|MIN)\(\s*([\w.]+)\s*\)$/i;
const GROUP_AGG_RE = /^GROUP_(SUM|COUNT|AVG|MAX|MIN)\(\s*([\w.]+)\s*\)$/i;
const PAGE_AGG_RE = /^PAGE_(SUM|COUNT|AVG|MAX|MIN)\(\s*([\w.]+)\s*\)$/i;
const QRCODE_RE = /^QRCODE\(\s*([\w.]+)\s*\)$/i;
const BARCODE_RE = /^(?:CODE128|BARCODE)\(\s*([\w.]+)\s*\)$/i;
const EXPR_RE = /([#$])\{([^}]+)\}/g;
const MM_TO_PX = 96 / 25.4;
const DEFAULT_ROW_HEIGHT = 24;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getValue(source: unknown, path: string): unknown {
  if (!path) return source;
  return path.split('.').reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), source);
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

function substituteCell(cell: ReportPrintCell, ctx: TokenContext): ReportPrintCell {
  const next: ReportPrintCell = {
    ...cell,
    ...(cell.s ? { s: { ...cell.s, ...(cell.s.border ? { border: getBorderStyle(cell.s.border) } : {}) } } : {}),
    ...(cell.image ? { image: { ...cell.image } } : {}),
  };

  if (next.formula) {
    const formula = next.formula.startsWith('=') ? next.formula.slice(1) : next.formula;
    EXPR_RE.lastIndex = 0;
    next.formula = `=${formula.replace(EXPR_RE, (_full, marker: string, expr: string) => {
      const resolved = resolveToken(marker as '#' | '$', expr, ctx);
      if (resolved && typeof resolved === 'object' && 'kind' in resolved) return (resolved as SpecialToken).value;
      return resolved == null ? '' : String(resolved);
    })}`;
    next.kind = next.kind ?? 'formula';
  }
  if (next.image?.src) next.image.src = String(substituteText(next.image.src, ctx));
  if (typeof next.v !== 'string') return next;

  const substituted = substituteText(next.v, ctx);
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
): ReportPrintGrid {
  const cellsByRow = buildCellsByRow(grid);
  const cells: ReportPrintCell[] = [];
  const rowHeights: number[] = [];
  let outRow = 0;
  for (let templateRow = range.start; templateRow <= range.end; templateRow++) {
    for (const cell of cellsByRow.get(templateRow) ?? []) {
      cells.push({ ...substituteCell(cell, ctxFactory(templateRow)), row: outRow });
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

function renderVerticalSheet(sheet: ReportPrintSheet, rows: Row[], params: Record<string, unknown>): RenderedGridState {
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

  const baseCtx = { rows, params: params ?? {}, paramNames };
  const emitTemplateRow = (templateRow: number, ctx: TokenContext, detailRows: Row[] = []) => {
    for (const cell of cellsByRow.get(templateRow) ?? []) outCells.push({ ...substituteCell(cell, ctx), row: outRow });
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

function renderHorizontalSheet(sheet: ReportPrintSheet, rows: Row[], params: Record<string, unknown>): RenderedGridState {
  const grid = sheet.grid;
  const paramNames = new Set(Object.keys(params ?? {}));
  const detailCells = grid.cells.filter((cell) => hasDetailField(cell.v, paramNames));
  if (!detailCells.length) {
    const ctx: TokenContext = { row: rows[0] ?? null, rows, groupRows: rows, pageRows: [], params, paramNames };
    return {
      grid: {
        ...grid,
        cells: grid.cells.map((cell) => substituteCell(cell, ctx)),
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
        const ctx: TokenContext = { row: records[index], rows, groupRows: rows, pageRows: [], params, paramNames };
        outCells.push({ ...substituteCell(cell, ctx), col: bandStart + index * bandWidth + (cell.col - bandStart) });
      }
      continue;
    }
    const shift = cell.col > bandEnd ? (records.length - 1) * bandWidth : 0;
    outCells.push({ ...substituteCell(cell, { row: rows[0] ?? null, rows, groupRows: rows, pageRows: [], params, paramNames }), col: cell.col + shift });
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

function pageContentHeightPx(config: ReportPrintPageConfig, headerRowsHeight = 0): number {
  const paper = config.paper ?? 'A4';
  const [paperWidth, paperHeight] = PAPER_SIZE_MM[paper] ?? PAPER_SIZE_MM.A4;
  const usableHeightMm = (config.orientation === 'landscape' ? paperWidth : paperHeight) - (config.margin?.top ?? 12) - (config.margin?.bottom ?? 12);
  const bandPaddingPx = (config.header ? 24 : 0) + (config.footer ? 24 : 0) + headerRowsHeight;
  return Math.max(0, usableHeightMm * MM_TO_PX - bandPaddingPx);
}

function paginateSheet(
  sheet: ReportPrintSheet,
  rendered: RenderedGridState,
  rows: Row[],
  params: Record<string, unknown>,
): ReportPrintSheetRenderResult {
  const grid = rendered.grid;
  const cfg = sheet.pageConfig ?? {};
  if (grid.rows === 0) {
    return { id: sheet.id, name: sheet.name, grid, pageConfig: cfg, pages: [], rowCount: 0 };
  }

  const headerRange = normalizeRange(cfg.repeatHeaderRows, sheet.grid.rows);
  const headerStart = headerRange ? rendered.templateRowToOutputRows[headerRange.start]?.[0] ?? 0 : null;
  const headerEnd = headerRange ? rendered.templateRowToOutputRows[headerRange.end]?.[0] ?? headerStart ?? 0 : null;
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
      })));
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

function normalizeSheets(content: ReportPrintContent | undefined, pageConfig: ReportPrintPageConfig): ReportPrintSheet[] {
  if (content?.sheets?.length) {
    return content.sheets.map((sheet, index) => ({
      id: sheet.id || `sheet-${String(index + 1).padStart(2, '0')}`,
      name: sheet.name || `Sheet${index + 1}`,
      grid: sheet.grid,
      pageConfig: { ...pageConfig, ...(sheet.pageConfig ?? {}) },
    }));
  }
  if (content?.grid) {
    return [{
      id: 'sheet-01',
      name: 'Sheet1',
      grid: content.grid,
      pageConfig: { ...pageConfig },
    }];
  }
  return [{
    id: 'sheet-01',
    name: 'Sheet1',
    grid: { rows: 1, cols: 1, cells: [] },
    pageConfig: { ...pageConfig },
  }];
}

/**
 * 兼容旧接口：单 sheet 直接返回填充后的完整网格。
 */
export function fillPrintGrid(grid: ReportPrintGrid, rows: Row[], params: Record<string, unknown> = {}): ReportPrintGrid {
  const rendered = renderVerticalSheet({ id: 'sheet-01', name: 'Sheet1', grid, pageConfig: { detailDirection: 'vertical' } }, Array.isArray(rows) ? rows : [], params);
  return rendered.grid;
}

export function renderPrintContent(
  name: string,
  content: ReportPrintContent | undefined,
  rows: Row[],
  params: Record<string, unknown> = {},
  pageConfig: ReportPrintPageConfig = {},
): ReportPrintRenderResult {
  const data = Array.isArray(rows) ? rows : [];
  const sheets = normalizeSheets(content, pageConfig).map((sheet) => {
    const rendered = sheet.pageConfig?.detailDirection === 'horizontal'
      ? renderHorizontalSheet(sheet, data, params)
      : renderVerticalSheet(sheet, data, params);
    return paginateSheet(sheet, rendered, data, params);
  });

  const flatPages = sheets.flatMap((sheet) => sheet.pages);
  const totalPages = flatPages.length;
  const date = new Date().toISOString();
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
