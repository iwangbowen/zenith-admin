import { listReportDqRuns } from '../report-dq.service';
import { defineExport } from '../../../lib/export-center/registry';

interface ReportDqRunsExportQuery extends Record<string, unknown> {
  datasetId?: number;
  ruleId?: number;
  status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
}

function parseQuery(query: ReportDqRunsExportQuery) {
  return {
    datasetId: Number(query.datasetId) || undefined,
    ruleId: Number(query.ruleId) || undefined,
    status: query.status,
  };
}

function mapDqRunRow(row: Awaited<ReturnType<typeof listReportDqRuns>>['list'][number]) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    datasetId: row.datasetId,
    status: row.status,
    triggerType: row.triggerType,
    checkedRows: row.checkedRows,
    failedRows: row.failedRows,
    passRate: row.passRate,
    durationMs: row.durationMs,
    completedAt: row.completedAt,
    errorMessage: row.errorMessage,
  };
}

async function* streamReportDqRuns(query: ReportDqRunsExportQuery) {
  const pageSize = 1000;
  for (let page = 1; ; page++) {
    const result = await listReportDqRuns({ ...parseQuery(query), page, pageSize });
    for (const row of result.list) yield mapDqRunRow(row);
    if (result.list.length < pageSize) break;
  }
}

export const reportDqRunsExportDefinition = defineExport<ReportDqRunsExportQuery, Record<string, unknown>>({
  entity: 'report.dq-runs',
  moduleName: '报表数据质量',
  filenamePrefix: '数据质量运行历史',
  sheetName: '质量运行',
  permissions: { export: 'report:dq:export' },
  columns: [
    { key: 'id', header: '运行ID', type: 'number' },
    { key: 'ruleId', header: '规则ID', type: 'number' },
    { key: 'datasetId', header: '数据集ID', type: 'number' },
    { key: 'status', header: '状态' },
    { key: 'triggerType', header: '触发方式' },
    { key: 'checkedRows', header: '检查行数', type: 'number' },
    { key: 'failedRows', header: '失败行数', type: 'number' },
    { key: 'passRate', header: '通过率', type: 'number' },
    { key: 'durationMs', header: '耗时(ms)', type: 'number' },
    { key: 'completedAt', header: '完成时间', type: 'datetime' },
    { key: 'errorMessage', header: '错误' },
  ],
  countRows: async (query) => (await listReportDqRuns({ ...parseQuery(query), page: 1, pageSize: 1 })).total,
  streamRows: (query) => streamReportDqRuns(query),
});
