/**
 * 将 CSV 文本数据转换为 Univer 只读预览所需的精简 IWorkbookData 结构。
 *
 * 实现标准 RFC 4180 CSV 解析（支持带引号的字段、换行符、转义双引号）。
 * 返回格式与 xlsx-to-univer.ts 兼容，前端走相同的 ExcelPreviewPanel 渲染路径。
 */
import type { UniverWorkbookData, UniverWorksheetData, UniverCellData } from './xlsx-to-univer';

const CELL_TYPE_STRING = 1;

export interface CsvConvertOptions {
  /** 表格文件名（用于工作表名显示），默认 'Sheet1' */
  fileName?: string;
  /** 最大解析行数（防止超大 CSV 卡住浏览器），默认 2000 */
  maxRows?: number;
  /** 最大列数，默认 200 */
  maxColumns?: number;
}

const DEFAULTS = {
  maxRows: 2000,
  maxColumns: 200,
  defaultRowHeight: 24,
  defaultColumnWidth: 88,
};

/**
 * 解析单行 CSV 为字段数组（RFC 4180）。
 * 处理：带引号字段、字段内换行、转义双引号（""）。
 */
function parseCSVLine(line: string, delimiter = ','): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          // 转义双引号
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else if (char === '"') {
      inQuotes = true;
      i++;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * 将完整 CSV 文本解析为行列二维数组（兼容 \r\n 和 \n 换行）。
 * RFC 4180 允许字段内含换行，此处通过状态机逐字符处理。
 */
function parseCSV(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

  let current = '';
  let inQuotes = false;
  let fields: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const char = lines[i];
    if (inQuotes) {
      if (char === '"') {
        if (lines[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
    } else if (char === '\n') {
      fields.push(current);
      current = '';
      rows.push(fields);
      fields = [];
    } else {
      current += char;
    }
  }
  // 末尾没有换行的最后一行
  if (current !== '' || fields.length > 0) {
    fields.push(current);
    rows.push(fields);
  }

  return rows;
}

/**
 * 自动检测 CSV 分隔符（逗号、分号、制表符）。
 * 取前 5 行样本，选出频率最高的分隔符。
 */
function detectDelimiter(text: string): ',' | ';' | '\t' {
  const sample = text.split('\n').slice(0, 5).join('\n');
  const counts = {
    ',': (sample.match(/,/g) ?? []).length,
    ';': (sample.match(/;/g) ?? []).length,
    '\t': (sample.match(/\t/g) ?? []).length,
  };
  const max = Math.max(...Object.values(counts));
  if (max === 0) return ',';
  return (Object.entries(counts).find(([, v]) => v === max)?.[0] as ',' | ';' | '\t') ?? ',';
}

/**
 * 推断适合内容的列宽（粗略估算，不做精确字体测量）。
 * 基于该列前若干行的最大字符数按 7px/char 计算，上限 300px。
 */
function estimateColumnWidth(rows: string[][], colIndex: number, sampleRows = 50): number {
  let maxLen = 0;
  for (let i = 0; i < Math.min(sampleRows, rows.length); i++) {
    const val = rows[i][colIndex] ?? '';
    if (val.length > maxLen) maxLen = val.length;
  }
  // 约 7px/字符（英文），中文字符约 14px，此处统一用 8px 保守估算
  return Math.min(Math.max(maxLen * 8, 60), 300);
}

/**
 * 将 CSV 文本转换为 Univer 预览 IWorkbookData。
 */
export function csvTextToWorkbookData(
  text: string,
  options: CsvConvertOptions = {},
): UniverWorkbookData {
  const maxRows = options.maxRows ?? DEFAULTS.maxRows;
  const maxCols = options.maxColumns ?? DEFAULTS.maxColumns;
  const sheetName = options.fileName
    ? options.fileName.replace(/\.[^.]+$/, '') // 去掉扩展名
    : 'Sheet1';

  const delimiter = detectDelimiter(text);
  const allRows = parseCSV(text, delimiter);

  // 截断超限行
  const rows = allRows.slice(0, maxRows);
  if (rows.length === 0) {
    return emptyWorkbook(sheetName);
  }

  // 计算实际列数（取所有行的最大列数，不超上限）
  const maxDataCol = Math.min(
    rows.reduce((acc, row) => Math.max(acc, row.length), 0) - 1,
    maxCols - 1,
  );

  const cellData: Record<number, Record<number, UniverCellData>> = {};
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c <= Math.min(row.length - 1, maxDataCol); c++) {
      const val = row[c];
      if (!val) continue;
      // 尝试当作数字解析
      const num = Number(val);
      if (val !== '' && !Number.isNaN(num) && val.trim() !== '') {
        cellData[r] ??= {};
        cellData[r][c] = { v: num, t: 2 /* NUMBER */ };
      } else {
        cellData[r] ??= {};
        cellData[r][c] = { v: val, t: CELL_TYPE_STRING };
      }
    }
  }

  // 列宽估算
  const columnData: Record<number, { w: number }> = {};
  for (let c = 0; c <= maxDataCol; c++) {
    columnData[c] = { w: estimateColumnWidth(rows, c) };
  }

  const sheetId = 'sheet-1';
  const sheet: UniverWorksheetData = {
    id: sheetId,
    name: sheetName,
    rowCount: rows.length,
    columnCount: maxDataCol + 1,
    defaultColumnWidth: DEFAULTS.defaultColumnWidth,
    defaultRowHeight: DEFAULTS.defaultRowHeight,
    mergeData: [],
    cellData,
    rowData: {},
    columnData,
  };

  return {
    id: 'workbook-csv',
    name: sheetName,
    appVersion: '0.2.0',
    sheetOrder: [sheetId],
    styles: {},
    sheets: { [sheetId]: sheet },
  };
}

function emptyWorkbook(name: string): UniverWorkbookData {
  const sheetId = 'sheet-1';
  return {
    id: 'workbook-csv',
    name,
    appVersion: '0.2.0',
    sheetOrder: [sheetId],
    styles: {},
    sheets: {
      [sheetId]: {
        id: sheetId,
        name,
        rowCount: 10,
        columnCount: 10,
        defaultColumnWidth: DEFAULTS.defaultColumnWidth,
        defaultRowHeight: DEFAULTS.defaultRowHeight,
        mergeData: [],
        cellData: {},
        rowData: {},
        columnData: {},
      },
    },
  };
}
