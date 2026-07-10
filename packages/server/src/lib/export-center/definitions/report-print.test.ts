import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderPrintTemplate = vi.fn();
const renderPrintExportFile = vi.fn();
const reportPrintWorkUnits = vi.fn((result: { sheets: Array<{ rowCount: number; grid?: { rows: number; cols: number } }> }) =>
  result.sheets.reduce((sum, sheet) => sum + Math.max(
    sheet.rowCount,
    Math.max(1, sheet.grid?.rows ?? sheet.rowCount) * Math.max(1, sheet.grid?.cols ?? 1),
  ), 0));

vi.mock('../../../services/report/report-print.service', () => ({
  renderPrintTemplate,
}));

vi.mock('../../report-print-export', () => ({
  renderPrintExportFile,
  reportPrintWorkUnits,
}));

describe('reportPrintExportDefinition', () => {
  beforeEach(() => {
    renderPrintTemplate.mockReset();
    renderPrintExportFile.mockReset();
  });

  it('使用 auto 执行策略并按真实渲染行数统计', async () => {
    renderPrintTemplate.mockResolvedValue({
      sheets: [
        { rowCount: 3, grid: { rows: 3, cols: 2 } },
        { rowCount: 5, grid: { rows: 5, cols: 2 } },
      ],
    });

    const { reportPrintExportDefinition } = await import('./report-print');

    expect(reportPrintExportDefinition.formats).toEqual(['xlsx', 'pdf']);
    expect(reportPrintExportDefinition.execution.mode).toBe('auto');
    expect(reportPrintExportDefinition.execution.syncMaxRows).toBe(800);
    await expect(reportPrintExportDefinition.countRows!({ templateId: 1 })).resolves.toBe(16);
  });

  it('渲染 pdf 文件时透传 renderFile 返回值', async () => {
    renderPrintTemplate.mockResolvedValue({ sheets: [{ rowCount: 2, grid: { rows: 2, cols: 1 } }] });
    renderPrintExportFile.mockResolvedValue({
      buffer: Buffer.from('%PDF-demo'),
      mimeType: 'application/pdf',
      rowCount: 2,
    });

    const { reportPrintExportDefinition } = await import('./report-print');
    const file = await reportPrintExportDefinition.renderFile!({
      query: { templateId: 1 },
      format: 'pdf',
      jobId: 99,
      moduleName: '打印报表',
      entity: 'report.print',
      columns: [],
      exportConfig: undefined,
      visibleColumnKeys: undefined,
      raw: false,
      user: { id: 1, username: 'admin' },
    } as never);

    expect(renderPrintExportFile).toHaveBeenCalledWith({ sheets: [{ rowCount: 2, grid: { rows: 2, cols: 1 } }] }, 'pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.filename).toBe('打印报表_99.pdf');
    expect(file.rowCount).toBe(2);
  });
});
