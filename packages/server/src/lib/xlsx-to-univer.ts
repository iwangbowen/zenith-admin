/**
 * 将 xlsx 二进制（Buffer）转换为 Univer 只读预览所需的精简 IWorkbookData 结构。
 *
 * 复用项目已内置的 exceljs 解析，不引入额外依赖；输出为纯 JSON，前端用
 * `@univerjs/core` 的 `IWorkbookData` 接收并喂给 Univer 渲染。
 *
 * 仅覆盖「预览」所需：单元格值、基础样式（字体/对齐/填充/边框/数字格式）、
 * 合并单元格、行高列宽。公式以缓存结果值显示并保留公式串；图表、条件格式、
 * 数据透视等高级特性不在覆盖范围内。
 */
import ExcelJS from 'exceljs';

// ─── 与 @univerjs/core 对齐的枚举常量（避免后端依赖 Univer 包）────────────────
const CELL_TYPE = { STRING: 1, NUMBER: 2, BOOLEAN: 3 } as const;
const H_ALIGN: Record<string, number> = { left: 1, center: 2, right: 3 };
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, bottom: 3 };
const WRAP_STRATEGY = { OVERFLOW: 1, CLIP: 2, WRAP: 3 } as const;
const BOOLEAN_TRUE = 1;
const BORDER_THIN = 1;

// ─── 输出结构（结构化对齐 Univer IWorkbookData，字段最小化）──────────────────
export interface UniverCellData {
  v?: string | number | boolean;
  t?: number;
  s?: string;
  f?: string;
}

export interface UniverWorksheetData {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  defaultColumnWidth: number;
  defaultRowHeight: number;
  mergeData: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }>;
  cellData: Record<number, Record<number, UniverCellData>>;
  rowData: Record<number, { h?: number; ia?: number; ah?: number }>;
  columnData: Record<number, { w: number }>;
}

export interface UniverWorkbookData {
  id: string;
  name: string;
  appVersion: string;
  sheetOrder: string[];
  styles: Record<string, unknown>;
  sheets: Record<string, UniverWorksheetData>;
}

export interface XlsxConvertOptions {
  /** 工作簿展示名（通常为原始文件名） */
  fileName?: string;
  /** 最多解析的工作表数量 */
  maxSheets?: number;
  /** 单表最多解析的行数 */
  maxRows?: number;
  /** 单表最多解析的列数 */
  maxColumns?: number;
}

const DEFAULTS = {
  maxSheets: 20,
  maxRows: 2000,
  maxColumns: 200,
  defaultColumnWidth: 88,
  defaultRowHeight: 24,
};

/** ARGB（如 'FF1A7F37'）转为 CSS '#RRGGBB'；主题色（无 argb）返回 undefined */
function argbToRgb(argb?: string): string | undefined {
  if (!argb || typeof argb !== 'string') return undefined;
  let hex: string | undefined;
  if (argb.length === 8) hex = argb.slice(2);
  else if (argb.length === 6) hex = argb;
  return hex ? `#${hex.toUpperCase()}` : undefined;
}

/** Excel 字符列宽 → 近似像素宽 */
function colWidthToPx(width?: number): number | undefined {
  if (!width || width <= 0) return undefined;
  return Math.round(width * 7 + 5);
}

/** Excel 磅行高（pt）→ 像素高 */
function rowHeightToPx(height?: number): number | undefined {
  if (!height || height <= 0) return undefined;
  return Math.round((height * 4) / 3);
}

/** 列字母（A、AB...）转 0-based 列号 */
function columnLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + ((ch.codePointAt(0) ?? 0) - 64);
  return n - 1;
}

/** 解析合并区域 "A1:B2" → 0-based range */
function parseMergeRange(ref: string) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  const [, c1, r1, c2, r2] = m;
  return {
    startRow: Number(r1) - 1,
    startColumn: columnLettersToIndex(c1),
    endRow: Number(r2) - 1,
    endColumn: columnLettersToIndex(c2),
  };
}

/** 从单元格构建 Univer 样式对象；无样式返回 undefined */
function buildCellStyle(cell: ExcelJS.Cell): Record<string, unknown> | undefined {
  const style: Record<string, unknown> = {};

  const font = cell.font;
  if (font) {
    if (font.name) style.ff = font.name;
    if (font.size) style.fs = font.size;
    if (font.bold) style.bl = BOOLEAN_TRUE;
    if (font.italic) style.it = BOOLEAN_TRUE;
    if (font.underline) style.ul = { s: BOOLEAN_TRUE };
    if (font.strike) style.st = { s: BOOLEAN_TRUE };
    const cl = argbToRgb(font.color?.argb);
    if (cl) style.cl = { rgb: cl };
  }

  const fill = cell.fill;
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const bg = argbToRgb(fill.fgColor?.argb);
    if (bg) style.bg = { rgb: bg };
  }

  const alignment = cell.alignment;
  if (alignment) {
    if (alignment.horizontal && H_ALIGN[alignment.horizontal]) style.ht = H_ALIGN[alignment.horizontal];
    if (alignment.vertical && V_ALIGN[alignment.vertical]) style.vt = V_ALIGN[alignment.vertical];
    if (alignment.wrapText) style.tb = WRAP_STRATEGY.WRAP;
  }

  const border = cell.border;
  if (border) {
    const toSide = (b?: Partial<ExcelJS.Border>) => {
      if (!b?.style) return undefined;
      return { s: BORDER_THIN, cl: { rgb: argbToRgb(b.color?.argb) ?? '#000000' } };
    };
    const bd: Record<string, unknown> = {};
    const t = toSide(border.top);
    const b = toSide(border.bottom);
    const l = toSide(border.left);
    const r = toSide(border.right);
    if (t) bd.t = t;
    if (b) bd.b = b;
    if (l) bd.l = l;
    if (r) bd.r = r;
    if (Object.keys(bd).length > 0) style.bd = bd;
  }

  if (cell.numFmt) style.n = { pattern: cell.numFmt };

  return Object.keys(style).length > 0 ? style : undefined;
}

/** 从单元格提取 Univer 值（v / t）与公式（f） */
function mapCellValue(cell: ExcelJS.Cell): { v?: string | number | boolean; t?: number; f?: string } {
  const { ValueType } = ExcelJS;
  const type = cell.type;

  if (type === ValueType.Formula) {
    const value = cell.value as { formula?: string; result?: unknown } | null;
    const f = value?.formula ? `=${value.formula}` : undefined;
    const result = value?.result;
    if (typeof result === 'number') return { v: result, t: CELL_TYPE.NUMBER, f };
    if (typeof result === 'boolean') return { v: result, t: CELL_TYPE.BOOLEAN, f };
    const text = cell.text ?? '';
    return text === '' ? { f } : { v: text, t: CELL_TYPE.STRING, f };
  }

  if (type === ValueType.Number) return { v: cell.value as number, t: CELL_TYPE.NUMBER };
  if (type === ValueType.Boolean) return { v: cell.value as boolean, t: CELL_TYPE.BOOLEAN };
  if (type === ValueType.Null || type === ValueType.Merge) return {};

  // Date / Hyperlink / RichText / String / Error 等：用 exceljs 格式化后的显示文本
  const text = cell.text ?? '';
  return text === '' ? {} : { v: text, t: CELL_TYPE.STRING };
}

/**
 * 将 xlsx 二进制数据转换为 Univer 预览数据。解析失败时抛出原始错误，由调用方处理。
 */
export async function xlsxBufferToWorkbookData(
  data: ArrayBuffer,
  options: XlsxConvertOptions = {},
): Promise<UniverWorkbookData> {
  const maxSheets = options.maxSheets ?? DEFAULTS.maxSheets;
  const maxRows = options.maxRows ?? DEFAULTS.maxRows;
  const maxColumns = options.maxColumns ?? DEFAULTS.maxColumns;

  const workbook = new ExcelJS.Workbook();
  // exceljs 自带的 Buffer 类型定义与 @types/node 的泛型 Buffer 存在已知摩擦（仅类型层面，运行时正常）
  // @ts-expect-error exceljs 的 xlsx.load 参数类型过时，与当前 @types/node 的 Buffer 不兼容
  await workbook.xlsx.load(Buffer.from(data));

  const styles: Record<string, unknown> = {};
  const styleKeyToId = new Map<string, string>();
  let styleSeq = 0;
  const internStyle = (style?: Record<string, unknown>): string | undefined => {
    if (!style) return undefined;
    const key = JSON.stringify(style);
    const existing = styleKeyToId.get(key);
    if (existing) return existing;
    const id = `s${++styleSeq}`;
    styleKeyToId.set(key, id);
    styles[id] = style;
    return id;
  };

  const sheets: Record<string, UniverWorksheetData> = {};
  const sheetOrder: string[] = [];

  workbook.worksheets.slice(0, maxSheets).forEach((ws, index) => {
    const sheetId = `sheet-${index + 1}`;
    sheetOrder.push(sheetId);

    const cellData: Record<number, Record<number, UniverCellData>> = {};
    const rowData: Record<number, { h?: number; ia?: number; ah?: number }> = {};
    let maxDataRow = 0;
    let maxDataCol = 0;

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > maxRows) return;
      const r = rowNumber - 1;

      const h = rowHeightToPx(row.height);
      // exceljs 读取时不保留 customHeight 标志，无法区分用户固定行高与 Excel 自动计算行高。
      // 为确保 wrapText 单元格的行高能自动跟随内容，对所有行设置 ia:1（自适应），
      // 同时将 Excel 给出的高度作为 ah（初始参考高度），Univer 将在此基础上向上扩展。
      if (h) {
        rowData[r] = { ia: 1, ah: h };
      } else {
        rowData[r] = { ia: 1 };
      }

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber > maxColumns) return;
        const c = colNumber - 1;

        const mapped = mapCellValue(cell);
        const styleId = internStyle(buildCellStyle(cell));
        if (mapped.v === undefined && mapped.f === undefined && !styleId) return;

        const cellObj: UniverCellData = {};
        if (mapped.v !== undefined) cellObj.v = mapped.v;
        if (mapped.t !== undefined) cellObj.t = mapped.t;
        if (mapped.f) cellObj.f = mapped.f;
        if (styleId) cellObj.s = styleId;

        cellData[r] ??= {};
        cellData[r][c] = cellObj;
        if (r > maxDataRow) maxDataRow = r;
        if (c > maxDataCol) maxDataCol = c;
      });
    });

    const mergeData: UniverWorksheetData['mergeData'] = [];
    const merges = ws.model?.merges ?? [];
    for (const ref of merges) {
      const range = parseMergeRange(ref);
      if (range && range.endRow < maxRows && range.endColumn < maxColumns) {
        mergeData.push(range);
      }
    }

    const columnData: Record<number, { w: number }> = {};
    ws.columns?.forEach((col, i) => {
      if (i >= maxColumns) return;
      const w = colWidthToPx(col?.width);
      if (w) columnData[i] = { w };
    });

    sheets[sheetId] = {
      id: sheetId,
      name: ws.name || `Sheet${index + 1}`,
      rowCount: Math.min(Math.max(maxDataRow + 1, 50), maxRows),
      columnCount: Math.min(Math.max(maxDataCol + 1, 26), maxColumns),
      defaultColumnWidth: DEFAULTS.defaultColumnWidth,
      defaultRowHeight: DEFAULTS.defaultRowHeight,
      mergeData,
      cellData,
      rowData,
      columnData,
    };
  });

  // 空工作簿兜底，保证 Univer 至少有一个可渲染的表
  if (sheetOrder.length === 0) {
    const sheetId = 'sheet-1';
    sheetOrder.push(sheetId);
    sheets[sheetId] = {
      id: sheetId,
      name: 'Sheet1',
      rowCount: 50,
      columnCount: 26,
      defaultColumnWidth: DEFAULTS.defaultColumnWidth,
      defaultRowHeight: DEFAULTS.defaultRowHeight,
      mergeData: [],
      cellData: {},
      rowData: {},
      columnData: {},
    };
  }

  return {
    id: `preview-${Date.now()}`,
    name: options.fileName ?? 'Sheet',
    appVersion: '0.1.0',
    sheetOrder,
    styles,
    sheets,
  };
}
