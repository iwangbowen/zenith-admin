import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { inspectImportWorkbook, parseImportWorkbook } from './parser';
import { buildImportTemplate } from './template';

async function workbookBuffer(headers: string[], rows: string[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('导入');
  sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  return book.xlsx.writeBuffer();
}

const columns = [
  { key: 'name', header: '姓名', aliases: ['显示名称'], required: true },
  { key: 'email', header: '邮箱', aliases: ['联系邮箱'] },
];

describe('import workbook mapping and inspection', () => {
  it('keeps template examples out of the data sheet', async () => {
    const Excel = await import('exceljs');
    const ExcelJS = (Excel as typeof Excel & { default?: typeof Excel }).default ?? Excel;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildImportTemplate('用户', [{ key: 'username', header: '用户名', required: true, example: 'demo-user' }]));
    expect(book.worksheets[0].getRow(2).getCell(1).value).toBeNull();
    expect(book.getWorksheet('填写说明')?.getCell('B4').value).toBe('demo-user');
  });
  it('suggests headers, preserves samples and accepts an explicit mapping', async () => {
    const buffer = await workbookBuffer(['姓名', '联系邮箱'], [['张三', 'a@example.com']]);
    const inspection = await inspectImportWorkbook(buffer, 'test', columns, 10, 'test.xlsx');
    expect(inspection.headers).toEqual(['姓名', '联系邮箱']);
    expect(inspection.rowCount).toBe(1);
    expect(inspection.sample[0]).toEqual({ 姓名: '张三', 联系邮箱: 'a@example.com' });
    const rows = await parseImportWorkbook(buffer, columns, 10, 'test.xlsx', { name: '姓名', email: '联系邮箱' });
    expect(rows[0]?.cells).toEqual({ name: '张三', email: 'a@example.com' });
  });

  it('redacts sensitive sample columns and never echoes unmapped source values', async () => {
    const buffer = await workbookBuffer(['登录名', '初始密码', '自定义秘密'], [['alice', 'Sup3rSecret!', 'hidden-value']]);
    const inspection = await inspectImportWorkbook(buffer, 'identity.users', [
      { key: 'username', header: '用户名', aliases: ['登录名'] },
      { key: 'password', header: '密码', aliases: ['初始密码'], sensitive: true },
    ], 10, 'users.xlsx');
    expect(inspection.sample).toEqual([{ 登录名: 'alice', 初始密码: '••••••', 自定义秘密: '（未映射）' }]);
    expect(JSON.stringify(inspection)).not.toContain('Sup3rSecret!');
    expect(JSON.stringify(inspection)).not.toContain('hidden-value');
  });

  it('keeps source column positions when headers contain blank spacer columns', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('导入');
    sheet.getCell('A1').value = '姓名'; sheet.getCell('C1').value = '联系邮箱';
    sheet.getCell('A2').value = '张三'; sheet.getCell('C2').value = 'a@example.com';
    const buffer = await book.xlsx.writeBuffer();
    const inspection = await inspectImportWorkbook(buffer, 'test', columns, 10, 'test.xlsx');
    expect(inspection.sample[0]).toEqual({ 姓名: '张三', 联系邮箱: 'a@example.com' });
  });

  it('bounds sparse formatted worksheet dimensions before scanning', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('导入');
    sheet.addRow(['姓名']);
    sheet.getCell('A10002').value = '';
    const buffer = await book.xlsx.writeBuffer();
    await expect(parseImportWorkbook(buffer, columns, 1000, 'large.xlsx')).rejects.toThrow('格式化空行');
  });

  it('rejects duplicate source headers and required fields missing after mapping', async () => {
    const duplicate = await workbookBuffer(['姓名', '姓名'], [['张三', '李四']]);
    await expect(parseImportWorkbook(duplicate, columns, 10, 'test.xlsx')).rejects.toThrow('重复表头');
    const missing = await workbookBuffer(['邮箱'], [['a@example.com']]);
    await expect(parseImportWorkbook(missing, columns, 10, 'test.xlsx')).rejects.toThrow('必需列');
  });
  it('counts physical non-empty rows before sample redaction and permits explicit optional-field omission', async () => {
    const buffer = await workbookBuffer(['姓名', '邮箱', '密码'], [['张三', 'a@example.com', 'secret'], ['', '', '']]);
    const inspection = await inspectImportWorkbook(buffer, 'test', [...columns, { key: 'password', header: '密码', sensitive: true }], 10, 'test.xlsx');
    expect(inspection.rowCount).toBe(1);
    expect(await parseImportWorkbook(buffer, columns, 10, 'test.xlsx', { name: '姓名', email: null })).toEqual([{ rowNum: 2, cells: { name: '张三', email: '' } }]);
    await expect(parseImportWorkbook(buffer, columns, 10, 'test.xlsx', { name: '姓名', email: '姓名' })).rejects.toThrow('同一文件列');
    await expect(parseImportWorkbook(buffer, columns, 10, 'test.xlsx', { name: '姓名', email: '不存在' })).rejects.toThrow('不存在');
  });
});
