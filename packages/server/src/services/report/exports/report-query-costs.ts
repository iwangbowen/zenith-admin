import { listReportQueryCostLogs } from '../report-query-capacity.service';
import { defineExport } from '../../../lib/export-center/registry';

interface ReportQueryCostsExportQuery extends Record<string, unknown> {
  datasetId?: number;
  datasourceId?: number;
  start?: string;
  end?: string;
}

function parseQuery(query: ReportQueryCostsExportQuery) {
  return {
    datasetId: Number(query.datasetId) || undefined,
    datasourceId: Number(query.datasourceId) || undefined,
    start: typeof query.start === 'string' ? query.start : undefined,
    end: typeof query.end === 'string' ? query.end : undefined,
  };
}

async function* streamReportQueryCosts(query: ReportQueryCostsExportQuery) {
  const pageSize = 1000;
  for (let page = 1; ; page++) {
    const result = await listReportQueryCostLogs({ ...parseQuery(query), page, pageSize });
    for (const row of result.list) yield { ...row };
    if (result.list.length < pageSize) break;
  }
}

export const reportQueryCostsExportDefinition = defineExport<ReportQueryCostsExportQuery, Record<string, unknown>>({
  entity: 'report.query-costs',
  moduleName: '报表查询容量',
  filenamePrefix: '报表查询成本日志',
  sheetName: '查询成本',
  permissions: { export: 'report:query-cost:export' },
  columns: [
    { key: 'occurredAt', header: '发生时间', type: 'datetime' },
    { key: 'userId', header: '用户ID', type: 'number' },
    { key: 'datasetId', header: '数据集ID', type: 'number' },
    { key: 'datasourceId', header: '数据源ID', type: 'number' },
    { key: 'scene', header: '场景' },
    { key: 'queuedMs', header: '排队(ms)', type: 'number' },
    { key: 'durationMs', header: '耗时(ms)', type: 'number' },
    { key: 'rowCount', header: '行数', type: 'number' },
    { key: 'byteSize', header: '字节', type: 'number' },
    { key: 'costUnits', header: '成本单位', type: 'number' },
    { key: 'cacheHit', header: '缓存命中', type: 'boolean' },
    { key: 'success', header: '成功', type: 'boolean' },
    { key: 'errorCode', header: '错误码' },
  ],
  countRows: async (query) => (await listReportQueryCostLogs({ ...parseQuery(query), page: 1, pageSize: 1 })).total,
  streamRows: (query) => streamReportQueryCosts(query),
});
