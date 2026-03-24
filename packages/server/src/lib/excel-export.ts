import ExcelJS from 'exceljs';

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

  for (const row of data) {
    const transformed: Record<string, unknown> = {};
    for (const col of columns) {
      const val = row[col.key];
      transformed[col.key] = col.transform ? col.transform(val) : val;
    }
    sheet.addRow(transformed);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as ArrayBuffer;
}
