/**
 * 打印报表导出定义（Excel / PDF / Word，接入统一导出中心）。
 * 多 Sheet / 分页结果统一复用 renderPrintTemplate。
 */
import { renderPrintTemplate, ensurePrintTemplateExists } from '../report-print.service';
import { renderPrintExportFile, reportPrintWorkUnits } from '../../../lib/report-print-export';
import { defineExport } from '../../../lib/export-center/registry';
import { ensureDatasetExists } from '../report-dataset.service';
import { HTTPException } from 'hono/http-exception';

async function authorizePrintDependencies(id: number, path: number[] = []) {
  if (path.includes(id) || path.length >= 10) throw new HTTPException(400, { message: '打印模板依赖循环或层数过深' });
  const template = await ensurePrintTemplateExists(id);
  if (template.datasetId) await ensureDatasetExists(template.datasetId);
  for (const binding of template.content.datasetBindings ?? []) await ensureDatasetExists(binding.datasetId);
  for (const sheet of template.content.sheets ?? (template.content.grid ? [{ grid: template.content.grid }] : [])) {
    for (const cell of sheet.grid.cells) if (cell.subreport) await authorizePrintDependencies(cell.subreport.templateId, [...path, id]);
  }
}

interface ReportPrintExportQuery extends Record<string, unknown> {
  templateId: number;
  params?: Record<string, unknown>;
  limit?: number;
}

function pickQuery(query: Record<string, unknown>): ReportPrintExportQuery {
  const templateId = Number(query.templateId);
  if (!Number.isInteger(templateId) || templateId <= 0) throw new Error('缺少有效的打印报表 ID');
  const params = query.params && typeof query.params === 'object' && !Array.isArray(query.params)
    ? (query.params as Record<string, unknown>)
    : undefined;
  return { templateId, params, limit: Number(query.limit) || undefined };
}

export const reportPrintExportDefinition = defineExport<ReportPrintExportQuery, Record<string, unknown>>({
  entity: 'report.print',
  moduleName: '打印报表',
  filenamePrefix: '打印报表',
  formats: ['xlsx', 'pdf', 'docx'],
  renderMode: 'custom',
  permissions: { export: 'report:print:list' },
  execution: { mode: 'auto', syncMaxRows: 800, syncModeOverridesAsyncPolicies: false },
  columns: [],
  authorizeDownload: async query => { await authorizePrintDependencies(pickQuery(query).templateId); },
  countRows: async (query) => {
    const { templateId, params, limit } = pickQuery(query);
    const result = await renderPrintTemplate(templateId, { params, limit });
    return reportPrintWorkUnits(result);
  },
  streamRows: () => [],
  renderFile: async (ctx) => {
    const { templateId, params, limit } = pickQuery(ctx.query);
    const result = await renderPrintTemplate(templateId, { params, limit });
    const format = ctx.format === 'pdf' || ctx.format === 'docx' ? ctx.format : 'xlsx';
    const rendered = await renderPrintExportFile(result, format);
    return {
      buffer: rendered.buffer,
      mimeType: rendered.mimeType,
      rowCount: rendered.rowCount,
      filename: `${ctx.moduleName}_${ctx.jobId}.${ctx.format}`,
    };
  },
});
