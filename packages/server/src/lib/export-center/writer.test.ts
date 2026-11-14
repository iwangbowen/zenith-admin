import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { JwtPayload } from '../../middleware/auth';
import { DEFAULT_EXPORT_EXECUTION, type AnyExportDefinition, type ExportRuntimeContext } from './types';
import { renderExportCsv, renderExportWorkbook, renderExportToPath } from './writer';

const definition = {
  entity: 'test.rows',
  moduleName: '测试导出',
  filenamePrefix: '测试导出',
  renderMode: 'table',
  permissions: { export: 'test:export' },
  columns: [
    { key: 'id', header: 'ID', type: 'number' as const },
    { key: 'name', header: '名称' },
  ],
  countRows: async () => 0,
  streamRows: async () => [],
} as unknown as AnyExportDefinition;

const user: JwtPayload = { userId: 1, username: 'tester', roles: [], tenantId: null };

function ctx(format: 'xlsx' | 'csv', rowLimit: number | null): ExportRuntimeContext {
  return {
    jobId: 1,
    entity: definition.entity,
    moduleName: definition.moduleName,
    format,
    query: {},
    selectedColumns: null,
    raw: true,
    masked: false,
    sensitive: false,
    watermark: false,
    currentUser: user,
    createdByName: null,
    exportedAt: new Date('2026-08-29T10:00:00.000Z'),
    maskRules: null,
    rowLimit,
  };
}

async function* rowsOf(count: number): AsyncGenerator<Record<string, unknown>> {
  for (let i = 1; i <= count; i++) yield { id: i, name: `row-${i}` };
}

describe('导出行数兜底上限（ExportRuntimeContext.rowLimit）', () => {
  it('默认执行策略带 50000 行绝对上限', () => {
    expect(DEFAULT_EXPORT_EXECUTION.maxRows).toBe(50_000);
  });

  it('xlsx：行数超过 rowLimit 时中止渲染', async () => {
    await expect(renderExportWorkbook(definition, rowsOf(6), ctx('xlsx', 5)))
      .rejects.toThrow('导出行数超过上限 5 行');
  });

  it('xlsx：行数在上限内正常产出文件', async () => {
    const buffer = await renderExportWorkbook(definition, rowsOf(3), ctx('xlsx', 5));
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('csv：行数超过 rowLimit 时中止渲染', async () => {
    await expect(renderExportCsv(definition, rowsOf(6), ctx('csv', 5)))
      .rejects.toThrow('导出行数超过上限 5 行');
  });

  it('csv：行数在上限内正常产出且包含全部数据行', async () => {
    const buffer = await renderExportCsv(definition, rowsOf(3), ctx('csv', 5));
    const text = buffer.toString('utf-8');
    expect(text).toContain('row-1');
    expect(text).toContain('row-3');
  });

  it('rowLimit 为 null 时不限制（同步小导出路径不受影响）', async () => {
    const buffer = await renderExportCsv(definition, rowsOf(8), ctx('csv', null));
    expect(buffer.toString('utf-8')).toContain('row-8');
  });

  it('流式 xlsx：多级表头 + 水印产物可读回（合并/冻结/隐藏元信息表完整）', async () => {
    const nested = {
      ...definition,
      styles: undefined,
      columns: [
        { key: 'id', header: 'ID', type: 'number' as const },
        {
          header: '联系方式',
          children: [
            { key: 'name', header: '名称' },
            { key: 'code', header: '编码' },
          ],
        },
      ],
    } as unknown as AnyExportDefinition;
    async function* nestedRows(): AsyncGenerator<Record<string, unknown>> {
      yield { id: 1, name: '甲', code: 'A-1' };
      yield { id: 2, name: '乙', code: 'B-2' };
    }
    const context = { ...ctx('xlsx', 100), watermark: true };
    const buffer = await renderExportWorkbook(nested, nestedRows(), context);

    const { createRequire } = await import('node:module');
    const ExcelJS = createRequire(import.meta.url)('exceljs') as typeof import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet('测试导出')!;
    // 水印 2 行 + 表头 2 行，数据从第 5 行开始
    expect(sheet.getCell(1, 1).value).toBe('测试导出');
    expect(sheet.getCell(3, 1).value).toBe('ID');
    expect(sheet.getCell(3, 2).value).toBe('联系方式');
    expect(sheet.getCell(4, 2).value).toBe('名称');
    expect(sheet.getCell(4, 3).value).toBe('编码');
    expect(sheet.getCell(5, 2).value).toBe('甲');
    expect(sheet.getCell(6, 3).value).toBe('B-2');
    // 冻结表头视图
    expect(sheet.views?.[0]?.ySplit).toBe(4);
    // 隐藏的导出信息表
    const meta = workbook.getWorksheet('导出信息')!;
    expect(meta.state).toBe('hidden');
    expect(meta.getCell(1, 1).value).toBe('任务 ID');
  });
});


describe('disk-backed snapshot exports', () => {
  it.each(['csv', 'xlsx'] as const)('treats %s row and byte budget failures as non-retryable input errors', async (format) => {
    const folder = await mkdtemp(join(tmpdir(), 'export-writer-test-'));
    try {
      await expect(renderExportToPath(definition, rowsOf(3), ctx(format, 2), join(folder, 'rows.' + format), 3)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('行数超过上限') });
      await expect(renderExportToPath(definition, rowsOf(1), { ...ctx(format, 10), byteLimit: 1 }, join(folder, 'bytes.' + format), 1)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('字节预算') });
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it.each(['csv', 'xlsx'] as const)('writes %s with accurate progress and no full output buffer', async (format) => {
    const folder = await mkdtemp(join(tmpdir(), 'export-writer-test-'));
    try {
      const progress = vi.fn(async () => undefined);
      const file = join(folder, `rows.${format}`);
      expect(await renderExportToPath(definition, rowsOf(501), { ...ctx(format, 600), progress }, file, 501)).toBe(501);
      expect(progress.mock.calls).toEqual([[0, 501], [250, 501], [500, 501], [501, 501]]);
      const buffer = await readFile(file);
      expect(buffer.length).toBeGreaterThan(0);
      if (format === 'csv') expect(buffer.toString()).toContain('row-501');
      else {
        const ExcelJS = await import('exceljs');
        const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as never);
        expect(book.worksheets[0].rowCount).toBe(502);
        expect(book.worksheets[0].getRow(502).getCell(2).value).toBe('row-501');
      }
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it('keeps reader-controlled CSV formula text literal and preserves masking', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'export-writer-test-'));
    try {
      const file = join(folder, 'safe.csv');
      const source = async function* () { yield { name: '=HYPERLINK("https://invalid")', phone: '13812345678' }; };
      const masked = { ...definition, columns: [{ key: 'name', header: '名称' }, { key: 'phone', header: '手机', sensitive: 'phone' as const }] };
      await renderExportToPath(masked, source(), { ...ctx('csv', 5), raw: false, masked: true }, file, 1);
      const text = await readFile(file, 'utf8');
      expect(text).toContain("'=HYPERLINK"); expect(text).not.toContain('13812345678'); expect(text).toContain('138****5678');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it('stops row consumption when the persisted job is cancelled', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'export-writer-test-'));
    try {
      let consumed = 0;
      const source = async function* () { for (let i = 0; i < 1000; i++) { consumed++; yield { id: i }; } };
      await expect(renderExportToPath(definition, source(), { ...ctx('csv', 1000), progress: async processed => { if (processed === 250) throw new Error('cancelled'); } }, join(folder, 'cancelled.csv'), 1000)).rejects.toThrow('cancelled');
      expect(consumed).toBe(250);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
