import ExcelJS from 'exceljs';
import { formatDateTime } from './datetime';

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

/** Generate an Excel buffer from column definitions and data rows */
export async function exportToExcel(
  columns: ExcelColumn[],
  data: Record<string, unknown>[],
  sheetName = 'Sheet1'
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
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
      const transformed: Record<string, unknown> = {};
      for (const col of columns) {
        const val = row[col.key];
        transformed[col.key] = col.transform ? col.transform(val) : val;
      }
      sheet.addRow(transformed);
    }
    if (i + BATCH_SIZE < data.length) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  return await workbook.xlsx.writeBuffer();
}

/** Generate a streaming Excel ReadableStream from column definitions and data rows */
export async function streamToExcel(
  columns: ExcelColumn[],
  data: Record<string, unknown>[],
  sheetName = 'Sheet1'
): Promise<ReadableStream> {
  const { PassThrough, Readable } = await import('node:stream');
  const passThrough = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: passThrough });
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((col) => ({
    key: col.key,
    width: col.width ?? 18,
  }));

  const headerRow = sheet.addRow(columns.map((col) => col.header));
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
  headerRow.commit();

  for (const row of data) {
    const values = columns.map((col) => {
      const val = row[col.key];
      return col.transform ? col.transform(val) : val;
    });
    sheet.addRow(values).commit();
  }

  sheet.commit();
  await workbook.commit();
  return Readable.toWeb(passThrough) as ReadableStream;
}
