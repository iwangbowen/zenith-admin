/**
 * 导入文件解析：表头定位 + 逐行取值归一。
 * exceljs 模块图大（实测 ~2.4s），惰性加载，仅在任务执行/模板生成时进入内存。
 */
import { HTTPException } from 'hono/http-exception';
import type { ImportColumnMeta } from '@zenith/shared/tasks';
import type { ImportInspection } from '@zenith/shared/tasks';

export interface ParsedImportRow {
  /** Excel 实际行号（从 2 开始，用户按它定位错误行） */
  rowNum: number;
  /** 按 column.key 归一后的单元格文本（已 trim；空单元格为 ''） */
  cells: Record<string, string>;
}

async function loadImportWorksheet(buffer: ArrayBuffer, filename?: string | null) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(filename ?? '');
  try {
    if (isCsv) {
      const { Readable } = await import('node:stream');
      await workbook.csv.read(Readable.from(Buffer.from(buffer)));
    } else {
      await workbook.xlsx.load(buffer);
    }
  } catch {
    throw new HTTPException(400, { message: isCsv ? '文件不是有效的 CSV' : '文件不是有效的 xlsx（请使用下载的模板填写）' });
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HTTPException(400, { message: 'Excel 文件无工作表' });
  return sheet;
}

/** 单元格值 → 文本：富文本拼接、日期转 ISO 日期、公式取结果 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { richText?: { text: string }[]; result?: unknown; text?: unknown; hyperlink?: string };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
    if (v.result !== undefined) return cellToText(v.result);
    if (v.text !== undefined) return cellToText(v.text);
    if (v.hyperlink) return String(v.hyperlink).trim();
    return '';
  }
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_\-:：()（）]/gu, '');
}

/**
 * 解析上传的导入文件（xlsx / csv，按文件名后缀分流）：
 * 按表头文案定位列（顺序无关），返回数据行列表。
 * 必需列缺失时抛 400（整个文件拒绝，不进入逐行阶段）。
 */
export async function parseImportWorkbook(
  buffer: ArrayBuffer,
  columns: ImportColumnMeta[],
  maxRows: number,
  filename?: string | null,
  fieldMapping?: Record<string, string>,
): Promise<ParsedImportRow[]> {
  const sheet = await loadImportWorksheet(buffer, filename);

  // 表头定位：模板表头可能带必填星号，匹配时剥掉再比对
  const headerToCol = new Map<string, number>();
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const raw = cellToText(cell.value).replace(/\*$/, '').trim();
    if (!raw) return;
    const normalized = normalizeHeader(raw);
    if (headerToCol.has(normalized)) throw new HTTPException(400, { message: `文件包含重复表头：${raw}` });
    headerToCol.set(normalized, colNumber);
    headers.push(raw);
  });
  const sourceFor = (column: ImportColumnMeta) => fieldMapping?.[column.key] ?? column.header;
  const missing = columns.filter((c) => c.required && !headerToCol.has(normalizeHeader(sourceFor(c)))).map((c) => c.header);
  if (missing.length > 0) {
    throw new HTTPException(400, { message: `表头缺少必需列：${missing.join('、')}（请使用下载的模板填写）` });
  }

  const rows: ParsedImportRow[] = [];
  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    const cells: Record<string, string> = {};
    let hasValue = false;
    for (const col of columns) {
      const colNumber = headerToCol.get(normalizeHeader(sourceFor(col)));
      const text = colNumber ? cellToText(row.getCell(colNumber).value) : '';
      cells[col.key] = text;
      if (text) hasValue = true;
    }
    if (hasValue) rows.push({ rowNum, cells });
  }
  if (rows.length > maxRows) {
    throw new HTTPException(400, { message: `数据行数（${rows.length}）超过单次上限 ${maxRows} 行，请拆分文件` });
  }
  return rows;
}

/** 读取表头、建议映射和少量样例，不创建任务也不触发业务校验。 */
export async function inspectImportWorkbook(
  buffer: ArrayBuffer,
  entity: string,
  columns: ImportColumnMeta[],
  maxRows: number,
  filename?: string | null,
): Promise<ImportInspection> {
  const sheet = await loadImportWorksheet(buffer, filename);
  const headers = [...new Set(sheet.getRow(1).values.slice(1).map(value => cellToText(value).replace(/\*$/, '').trim()).filter(Boolean))];
  const normalized = new Map(headers.map(header => [normalizeHeader(header), header]));
  const suggestedMapping = Object.fromEntries(columns.map(column => {
    const candidates = [column.header, ...(column.aliases ?? [])].map(normalizeHeader);
    return [column.key, candidates.map(candidate => normalized.get(candidate)).find(Boolean) ?? null];
  }));
  const sample: Record<string, string>[] = [];
  let rowCount = 0;
  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    const values = Object.fromEntries(headers.map((header, index) => [header, cellToText(row.getCell(index + 1).value)]));
    if (Object.values(values).some(Boolean)) {
      rowCount += 1;
      if (sample.length < 5) sample.push(values);
    }
  }
  if (rowCount > maxRows) throw new HTTPException(400, { message: `数据行数（${rowCount}）超过单次上限 ${maxRows} 行，请拆分文件` });
  return { entity, filename: filename ?? null, headers, rowCount, sample, suggestedMapping };
}
