/**
 * 报表文件数据集解析单测（CSV / Excel → { columns, rows }）。
 * 重点：CSV 引号转义、含逗号字段、BOM 去除、字符串保真（手机号/前导零不被 Number 破坏）、
 *      空表头回落 colN、Excel 首个工作表解析与数值类型保留。
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseDataFile } from './report-file-parse';

describe('parseDataFile - CSV', () => {
  it('解析表头与数据行，保留含逗号/转义引号的字段', async () => {
    const csv = '\uFEFFname,phone,note\nA,01234,"hello, world"\nB,00789,"quote ""x"" end"';
    const res = await parseDataFile(Buffer.from(csv, 'utf-8'), 'data.csv');
    expect(res.columns).toEqual(['name', 'phone', 'note']);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({ name: 'A', phone: '01234', note: 'hello, world' });
    expect(res.rows[1].note).toBe('quote "x" end');
  });

  it('CSV 全部保留字符串：前导零/大整数不被破坏', async () => {
    const csv = 'id\n00123\n90071992547409920000';
    const res = await parseDataFile(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(res.rows[0].id).toBe('00123');
    expect(res.rows[1].id).toBe('90071992547409920000');
  });

  it('空表头回落 colN', async () => {
    const csv = 'a,,c\n1,2,3';
    const res = await parseDataFile(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(res.columns).toEqual(['a', 'col2', 'c']);
  });

  it('空文件抛 400', async () => {
    await expect(parseDataFile(Buffer.from(''), 'x.csv')).rejects.toThrow();
  });
});

describe('parseDataFile - Excel', () => {
  it('解析首个工作表，首行为表头，保留数值类型', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['name', 'qty']);
    ws.addRow(['A', 2]);
    ws.addRow(['B', 5]);
    const buf = await wb.xlsx.writeBuffer();
    const res = await parseDataFile(Buffer.from(buf), 'data.xlsx');
    expect(res.columns).toEqual(['name', 'qty']);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({ name: 'A', qty: 2 });
    expect(res.rows[1]).toEqual({ name: 'B', qty: 5 });
  });
});
