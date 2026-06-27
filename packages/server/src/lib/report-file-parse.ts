/**
 * 报表「文件数据集」解析：上传 Excel/CSV → 归一化为 { columns, rows }。
 * - Excel：exceljs 读首个工作表，首行为表头。
 * - CSV：轻量解析（支持双引号转义 + 逗号分隔），首行为表头。
 */
import ExcelJS from 'exceljs';
import { HTTPException } from 'hono/http-exception';
import type { ReportDataResult } from '@zenith/shared';

const MAX_ROWS = 5000;

/** 解析一行 CSV（处理引号包裹与转义双引号） */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): ReportDataResult {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (lines.length === 0) return { columns: [], rows: [], total: 0 };
  const headers = parseCsvLine(lines[0]).map((h, i) => h.trim() || `col${i + 1}`);
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const raw = cells[idx] ?? '';
      const num = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
      row[h] = num;
    });
    rows.push(row);
  }
  return { columns: headers, rows, total: rows.length };
}

async function parseExcel(buffer: Buffer): Promise<ReportDataResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { columns: [], rows: [], total: 0 };
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? `col${col}`).trim() || `col${col}`;
  });
  const cols = headers.length;
  const rows: Record<string, unknown>[] = [];
  for (let r = 2; r <= ws.rowCount && rows.length < MAX_ROWS; r++) {
    const excelRow = ws.getRow(r);
    const row: Record<string, unknown> = {};
    let hasValue = false;
    for (let c = 1; c <= cols; c++) {
      const key = headers[c - 1] ?? `col${c}`;
      const v = excelRow.getCell(c).value;
      const val = v && typeof v === 'object' && 'result' in v ? (v as { result: unknown }).result : v;
      if (val !== null && val !== undefined && val !== '') hasValue = true;
      row[key] = val ?? '';
    }
    if (hasValue) rows.push(row);
  }
  return { columns: headers, rows, total: rows.length };
}

/** 按文件名后缀分派解析；返回归一化结果 */
export async function parseDataFile(buffer: Buffer, filename: string): Promise<ReportDataResult> {
  if (!buffer?.length) throw new HTTPException(400, { message: '文件为空' });
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.csv')) return parseCsv(buffer.toString('utf-8'));
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return parseExcel(buffer);
  // 兜底：尝试按 Excel 解析，失败则按 CSV
  try { return await parseExcel(buffer); } catch { return parseCsv(buffer.toString('utf-8')); }
}
