import { csvCell } from '@zenith/shared/core';
import { createRequire } from 'node:module';
import { formatDateTime } from './datetime';

// 惰性加载：exceljs 模块图大（实测 ~2.4s），仅在首次导出/解析 Excel 时加载
const require = createRequire(import.meta.url);
const loadExcelJS = () => require('exceljs') as typeof import('exceljs');

/** Format a date to 'YYYY-MM-DD HH:mm:ss'. Returns '' for null/undefined. */
export function formatDateTimeForExcel(date: Date | string | null | undefined): string {
  if (!date) return '';
  return formatDateTime(date);
}

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
  transform?: (value: unknown) => string;
}

/** Escape a cell value for CSV output. Wraps in double-quotes when necessary. */
export const csvEscapeCell = csvCell;

// 每个流式导出已写的数据行数（不含表头）：由 streamToExcel / streamToCsv 边消费边累加，
// 排空后经 getStreamRowCount 读取；WeakMap 持有计数，不阻止流被回收。
const streamRowCounts = new WeakMap<ReadableStream, { value: number }>();

/**
 * Data rows written to a stream from `streamToExcel` / `streamToCsv`; only meaningful
 * after full consumption. `undefined` for streams not created by those helpers.
 */
export function getStreamRowCount(stream: ReadableStream): number | undefined {
  return streamRowCounts.get(stream)?.value;
}

/**
 * Generate a streaming CSV ReadableStream from column definitions and data rows.
 * Prepends a UTF-8 BOM so Excel opens the file with correct encoding.
 *
 * `data` accepts both plain arrays and async iterables (e.g. `batchIterable(...)`).
 *
 * @example
 * const stream = streamToCsv(columns, batchIterable(...));
 * return csvStreamBody(c, stream, 'report.csv');
 */
export function streamToCsv(
  columns: ExcelColumn[],
  data: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
): ReadableStream {
  const encoder = new TextEncoder();
  const headerLine = columns.map((c) => csvEscapeCell(c.header)).join(',') + '\n';
  const counter = { value: 0 };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // BOM + header
      controller.enqueue(encoder.encode('\uFEFF' + headerLine));
      try {
        const BATCH_SIZE = 500;
        let batch: string[] = [];
        for await (const row of data) {
          counter.value++;
          const val = (c: ExcelColumn) => c.transform ? c.transform(row[c.key]) : row[c.key];
          batch.push(columns.map((c) => csvEscapeCell(val(c))).join(','));
          if (batch.length >= BATCH_SIZE) {
            controller.enqueue(encoder.encode(batch.join('\n') + '\n'));
            batch = [];
            // Yield to event loop between batches to avoid blocking
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
        if (batch.length > 0) {
          controller.enqueue(encoder.encode(batch.join('\n') + '\n'));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  streamRowCounts.set(stream, counter);
  return stream;
}

/** Apply column transforms to a data row, returning a plain object keyed by column key. */
function applyTransforms(columns: ExcelColumn[], row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const col of columns) {
    const val = row[col.key];
    result[col.key] = col.transform ? col.transform(val) : val;
  }
  return result;
}

/** Generate an Excel buffer from column definitions and data rows */
export async function exportToExcel(
  columns: ExcelColumn[],
  data: Record<string, unknown>[],
  sheetName = 'Sheet1'
): Promise<ArrayBuffer> {
  const workbook = new (loadExcelJS().Workbook)();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width ?? 18,
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E8E8' },
  };

  const BATCH_SIZE = 500;
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    for (const row of data.slice(i, i + BATCH_SIZE)) {
      sheet.addRow(applyTransforms(columns, row));
    }
    if (i + BATCH_SIZE < data.length) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  return await workbook.xlsx.writeBuffer();
}

/**
 * Yields rows from a paginated fetch function in batches, enabling memory-efficient
 * async iteration without loading the entire result set at once.
 *
 * @param fetchFn  - A function that accepts `(limit, offset)` and returns a row batch.
 * @param batchSize - Rows per batch (default: 2000).
 *
 * @example
 * const rows = batchIterable(
 *   (limit, offset) =>
 *     db.select().from(loginLogs).where(cond).orderBy(desc(loginLogs.id)).limit(limit).offset(offset),
 * );
 * const stream = await streamToExcel(columns, rows, sheetName);
 */
export async function* batchIterable<T>(
  fetchFn: (limit: number, offset: number) => Promise<T[]>,
  batchSize = 2000
): AsyncIterable<T> {
  let offset = 0;
  while (true) {
    const batch = await fetchFn(batchSize, offset);
    for (const row of batch) yield row;
    if (batch.length < batchSize) break;
    offset += batchSize;
  }
}

/** Generate a streaming Excel ReadableStream from column definitions and data rows.
 *
 * Returning before any write avoids backpressure deadlock: awaiting workbook.commit()
 * here would hang waiting for a consumer that has not started yet. `data` accepts plain
 * arrays and async iterables (e.g. `batchIterable(...)`); rows are written in object mode
 * so ExcelJS maps values to cells by column key, not array position.
 */
export function streamToExcel(
  columns: ExcelColumn[],
  data: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
  sheetName = 'Sheet1'
): Promise<ReadableStream> {
  return new Promise((resolve, reject) => {
    import('node:stream').then(({ PassThrough, Readable }) => {
      const passThrough = new PassThrough();
      // 立即返回 Web ReadableStream：HTTP 响应边消费边由 ExcelJS 异步写入
      const webStream = Readable.toWeb(passThrough) as ReadableStream;
      const counter = { value: 0 };
      streamRowCounts.set(webStream, counter);
      resolve(webStream);

      const workbook = new (loadExcelJS().stream.xlsx.WorkbookWriter)({ stream: passThrough });
      const sheet = workbook.addWorksheet(sheetName);

      sheet.columns = columns.map((col) => ({
        key: col.key,
        width: col.width ?? 18,
      }));

      const headerRow = sheet.addRow(columns.map((col) => col.header));
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
      headerRow.commit();

      // `for await...of` handles both sync Iterable (arrays) and AsyncIterable (generators,
      // batchIterable cursors, etc.) so callers can pass either without any conversion.
      (async () => {
        for await (const row of data) {
          counter.value++;
          sheet.addRow(applyTransforms(columns, row)).commit();
        }
        sheet.commit();
        await workbook.commit();
      })().catch((err: Error) => passThrough.destroy(err));
    }).catch(reject);
  });
}
