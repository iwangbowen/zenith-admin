import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { inspectImportWorkbook, parseImportWorkbook } from './parser';

async function workbookBuffer(headers: string[], rows: string[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('导入');
  sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  return book.xlsx.writeBuffer();
}

const columns = [
  { key: 'name', header: '姓名', aliases: ['显示名称'], required: true },
  { key: 'email', header: '邮箱' },
];

describe('import workbook mapping and inspection', () => {
  it('suggests headers, preserves samples and accepts an explicit mapping', async () => {
    const buffer = await workbookBuffer(['姓名', '联系邮箱'], [['张三', 'a@example.com']]);
    const inspection = await inspectImportWorkbook(buffer, 'test', columns, 10, 'test.xlsx');
    expect(inspection.headers).toEqual(['姓名', '联系邮箱']);
    expect(inspection.rowCount).toBe(1);
    expect(inspection.sample[0]).toEqual({ 姓名: '张三', 联系邮箱: 'a@example.com' });
    const rows = await parseImportWorkbook(buffer, columns, 10, 'test.xlsx', { name: '姓名', email: '联系邮箱' });
    expect(rows[0]?.cells).toEqual({ name: '张三', email: 'a@example.com' });
  });

  it('rejects duplicate source headers and required fields missing after mapping', async () => {
    const duplicate = await workbookBuffer(['姓名', '姓名'], [['张三', '李四']]);
    await expect(parseImportWorkbook(duplicate, columns, 10, 'test.xlsx')).rejects.toThrow('重复表头');
    const missing = await workbookBuffer(['邮箱'], [['a@example.com']]);
    await expect(parseImportWorkbook(missing, columns, 10, 'test.xlsx')).rejects.toThrow('必需列');
  });
});
