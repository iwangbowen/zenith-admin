/**
 * 类 Excel 单据/中国式报表 —— 取数填充引擎（纯函数，前后端共用）。
 *
 * 单元格表达式语法（JimuReport 风格）：
 *   ${field}        明细字段 → 纵向扩展（同一行的明细单元格组成「明细带」，按数据行重复）
 *   #{field}        标量字段 → 取首行值（表头/单据信息区）
 *   ${param}        参数     → 当名称命中已声明参数时按参数解析（优先于字段）
 *   ${SUM(field)}   聚合     → 对全部数据行求 SUM/COUNT/AVG/MAX/MIN，标量、不扩展
 *   其余文本/公式    原样保留（支持「前缀${field}后缀」混合文本，逐行替换）
 *
 * 设计：模板网格(ReportPrintGrid) + 数据行 + 参数 → 填充后的网格(ReportPrintGrid)。
 * 合并单元格：明细带内的合并随数据行克隆；非带区合并整体下移。
 */
import type { ReportPrintGrid, ReportPrintCell, ReportPrintMerge } from './types';

type Row = Record<string, unknown>;

const AGG_RE = /^(SUM|COUNT|AVG|MAX|MIN)\(\s*([\w.]+)\s*\)$/i;
const EXPR_RE = /([#$])\{([^}]+)\}/g;

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function aggregate(rows: Row[], fn: string, field: string): number {
  const f = fn.toUpperCase();
  if (f === 'COUNT') return rows.length;
  const nums = rows.map((r) => toNum(r[field]));
  if (nums.length === 0) return 0;
  switch (f) {
    case 'SUM': return nums.reduce((a, b) => a + b, 0);
    case 'AVG': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'MAX': return Math.max(...nums);
    case 'MIN': return Math.min(...nums);
    default: return 0;
  }
}

/** 解析单个 ${expr}/#{expr} 占位符为值 */
function resolveToken(
  marker: '#' | '$',
  expr: string,
  ctx: { row: Row | null; rows: Row[]; params: Record<string, unknown>; paramNames: Set<string> },
): unknown {
  const name = expr.trim();
  if (marker === '#') {
    // 标量字段：取首行
    return ctx.rows[0]?.[name] ?? '';
  }
  const agg = AGG_RE.exec(name);
  if (agg) return aggregate(ctx.rows, agg[1], agg[2]);
  if (ctx.paramNames.has(name)) return ctx.params[name] ?? '';
  // 明细字段：有当前行则取当前行，否则空
  return ctx.row ? (ctx.row[name] ?? '') : '';
}

/** 判断单元格文本是否含「明细字段」(${field}，非聚合、非参数) → 决定是否纵向扩展 */
function hasDetailField(v: unknown, paramNames: Set<string>): boolean {
  if (typeof v !== 'string') return false;
  EXPR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPR_RE.exec(v)) !== null) {
    if (m[1] !== '$') continue;
    const name = m[2].trim();
    if (AGG_RE.test(name)) continue;
    if (paramNames.has(name)) continue;
    return true;
  }
  return false;
}

/** 替换单元格文本中的所有占位符；若整体恰为单一表达式且结果为数值则返回 number */
function substituteValue(
  v: unknown,
  ctx: { row: Row | null; rows: Row[]; params: Record<string, unknown>; paramNames: Set<string> },
): string | number | boolean | null {
  if (typeof v !== 'string' || (!v.includes('${') && !v.includes('#{'))) {
    return (v ?? null) as string | number | boolean | null;
  }
  // 单一完整表达式 → 保留原始类型（数值）
  const whole = /^([#$])\{([^}]+)\}$/.exec(v.trim());
  if (whole) {
    const val = resolveToken(whole[1] as '#' | '$', whole[2], ctx);
    if (typeof val === 'number' || typeof val === 'boolean') return val;
    return val == null ? '' : String(val);
  }
  EXPR_RE.lastIndex = 0;
  return v.replace(EXPR_RE, (_full, marker: string, expr: string) => {
    const val = resolveToken(marker as '#' | '$', expr, ctx);
    return val == null ? '' : String(val);
  });
}

/**
 * 填充打印报表网格。
 * @param grid   模板网格（含表达式）
 * @param rows   数据集数据行
 * @param params 已解析参数值
 */
export function fillPrintGrid(grid: ReportPrintGrid, rows: Row[], params: Record<string, unknown> = {}): ReportPrintGrid {
  const data = Array.isArray(rows) ? rows : [];
  const paramNames = new Set(Object.keys(params ?? {}));
  const ctxBase = { rows: data, params: params ?? {}, paramNames };

  // 模板行 → 单元格映射
  const cellsByRow = new Map<number, ReportPrintCell[]>();
  for (const c of grid.cells ?? []) {
    if (!cellsByRow.has(c.row)) cellsByRow.set(c.row, []);
    cellsByRow.get(c.row)!.push(c);
  }

  // 标记明细行
  const isDetailRow = (r: number): boolean => (cellsByRow.get(r) ?? []).some((c) => hasDetailField(c.v, paramNames));

  // 计算「带」：连续明细行成组
  const tRows = grid.rows ?? 0;
  const detailFlags: boolean[] = [];
  for (let r = 0; r < tRows; r++) detailFlags[r] = isDetailRow(r);

  // 模板行 → 输出行索引列表
  const tRowToOut: number[][] = Array.from({ length: tRows }, () => []);
  const outCells: ReportPrintCell[] = [];
  const outRowHeights: number[] = [];
  let outR = 0;

  let r = 0;
  while (r < tRows) {
    if (!detailFlags[r]) {
      // 非明细行：渲染一次
      for (const c of cellsByRow.get(r) ?? []) {
        outCells.push({ row: outR, col: c.col, v: substituteValue(c.v, { ...ctxBase, row: null }), s: c.s });
      }
      tRowToOut[r].push(outR);
      outRowHeights[outR] = grid.rowHeights?.[r] ?? 0;
      outR++;
      r++;
    } else {
      // 明细带：收集连续明细行 [r..bandEnd]
      let bandEnd = r;
      while (bandEnd + 1 < tRows && detailFlags[bandEnd + 1]) bandEnd++;
      const bandRows: number[] = [];
      for (let br = r; br <= bandEnd; br++) bandRows.push(br);
      const records = data.length > 0 ? data : [null]; // 无数据时保留一行空带
      for (const rec of records) {
        for (const br of bandRows) {
          for (const c of cellsByRow.get(br) ?? []) {
            outCells.push({ row: outR, col: c.col, v: substituteValue(c.v, { ...ctxBase, row: rec }), s: c.s });
          }
          tRowToOut[br].push(outR);
          outRowHeights[outR] = grid.rowHeights?.[br] ?? 0;
          outR++;
        }
      }
      r = bandEnd + 1;
    }
  }

  // 合并单元格重映射
  const outMerges: ReportPrintMerge[] = [];
  for (const m of grid.merges ?? []) {
    const r0 = m.row, r1 = m.row + m.rowSpan - 1;
    const inBand = detailFlags.slice(r0, r1 + 1).every(Boolean) && (r1 >= r0);
    const noBand = detailFlags.slice(r0, r1 + 1).every((f) => !f);
    if (inBand) {
      // 带内合并：随每条数据克隆（各模板行的输出索引按数据序对齐）
      const clones = tRowToOut[r0].length;
      for (let k = 0; k < clones; k++) {
        const start = tRowToOut[r0][k];
        const endRowOut = tRowToOut[r1]?.[k];
        if (start == null || endRowOut == null) continue;
        outMerges.push({ row: start, col: m.col, rowSpan: endRowOut - start + 1, colSpan: m.colSpan });
      }
    } else if (noBand) {
      const start = tRowToOut[r0]?.[0];
      const endRowOut = tRowToOut[r1]?.[0];
      if (start != null && endRowOut != null) {
        outMerges.push({ row: start, col: m.col, rowSpan: endRowOut - start + 1, colSpan: m.colSpan });
      }
    }
    // 跨带边界的合并：忽略，避免错位
  }

  return {
    rows: outR,
    cols: grid.cols,
    colWidths: grid.colWidths,
    rowHeights: outRowHeights,
    cells: outCells,
    merges: outMerges,
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
    .replace(/\$\{(\w+)\}/g, (_m, k: string) => String(params?.[k] ?? ''))
    .replace(/\{page\}/g, String(ctx.page ?? ''))
    .replace(/\{pages\}/g, String(ctx.pages ?? ''))
    .replace(/\{date\}/g, ctx.date ?? '');
}
