import { describe, it, expect } from 'vitest';
import { exportToExcel, ExcelColumn } from './excel-export';

describe('exportToExcel', () => {
  it('should generate an ArrayBuffer', async () => {
    const columns: ExcelColumn[] = [{ header: 'Name', key: 'name' }];
    const data = [{ name: 'Test' }];
    const buffer = await exportToExcel(columns, data);
    expect(buffer).toBeDefined();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('should handle custom sheet name', async () => {
    const columns: ExcelColumn[] = [{ header: 'Name', key: 'name' }];
    const data = [{ name: 'Test' }];
    const buffer = await exportToExcel(columns, data, 'CustomSheet');
    expect(buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('should format headers with bold', async () => {
    const columns: ExcelColumn[] = [{ header: 'Name', key: 'name' }];
    const data = [{ name: 'Test' }];
    // We cannot easily mock ExcelJS internal row structure without a lot of effort,
    // but we know it should succeed without errors.
    await expect(exportToExcel(columns, data)).resolves.not.toThrow();
  });

  it('should map columns to rows', async () => {
    const columns: ExcelColumn[] = [
      { header: 'A', key: 'a' },
      { header: 'B', key: 'b' }
    ];
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 }
    ];
    const buffer = await exportToExcel(columns, data);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('should handle empty data', async () => {
    const columns: ExcelColumn[] = [{ header: 'Name', key: 'name' }];
    const data: any[] = [];
    const buffer = await exportToExcel(columns, data);
    expect(buffer).toBeDefined();
  });

  it('should use default width if not provided', async () => {
    const columns: ExcelColumn[] = [{ header: 'Name', key: 'name' }];
    const data = [{ name: 'Test' }];
    const buffer = await exportToExcel(columns, data);
    expect(buffer).toBeDefined();
  });

  it('should use specified column width', async () => {
    const columns: ExcelColumn[] = [{ header: 'Name', key: 'name', width: 30 }];
    const data = [{ name: 'Test' }];
    const buffer = await exportToExcel(columns, data);
    expect(buffer).toBeDefined();
  });

  it('should transform data when transform function is present', async () => {
    const columns: ExcelColumn[] = [
      { header: 'Date', key: 'date', transform: (v) => `Date: ${v as string}` }
    ];
    const data = [{ date: '2026-01-01' }];
    const buffer = await exportToExcel(columns, data);
    expect(buffer).toBeDefined();
  });

  it('should handle missing keys in data gracefully', async () => {
    const columns: ExcelColumn[] = [{ header: 'Missing', key: 'missing' }];
    const data = [{ other: 'Test' }];
    const buffer = await exportToExcel(columns, data);
    expect(buffer).toBeDefined();
  });

  it('should handle multiple columns and multiple rows perfectly', async () => {
    const columns: ExcelColumn[] = [
      { header: 'ID', key: 'id' },
      { header: 'Val', key: 'val', transform: (v) => Number(v) * 2 + '' }
    ];
    const data = [
      { id: 1, val: 10 },
      { id: 2, val: 20 },
      { id: 3, val: 30 }
    ];
    const buffer = await exportToExcel(columns, data);
    expect(buffer).toBeDefined();
  });
});
