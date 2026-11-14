import { listAdminReportFillRecords } from '../report-fill-record.service';
import type { ReportFillRecordStatus } from '@zenith/shared/report';
import { defineExport } from '../../../lib/export-center/registry';
import { flattenWorkflowValueFields } from '@zenith/shared/workflow';
import type { ExportColumn } from '../../../lib/export-center/types';

interface ReportFillRecordsExportQuery extends Record<string, unknown> {
  status?: ReportFillRecordStatus;
  templateId?: number;
  submitterId?: number;
}

function parseQuery(query: ReportFillRecordsExportQuery) {
  return {
    status: query.status,
    templateId: Number(query.templateId) || undefined,
    submitterId: Number(query.submitterId) || undefined,
  };
}

function mapFillRecordRow(row: Awaited<ReturnType<typeof listAdminReportFillRecords>>['list'][number]) {
  return {
    id: row.id,
    templateName: row.templateName,
    submitterName: row.submitterName,
    businessData: JSON.stringify(row.data),
    templateId: row.templateId,
    submitterId: row.submitterId,
    status: row.status,
    templateRevision: row.templateRevision,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    workflowInstanceId: row.workflowInstanceId,
    generatedDatasetId: row.generatedDatasetId,
    syncStatus: row.syncStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...Object.fromEntries(flattenWorkflowValueFields(row.templateSchemaSnapshot.fields).map(field => [
      ['field', row.templateId, row.templateRevision, field.key].join('_'),
      typeof row.data[field.key] === 'object' ? JSON.stringify(row.data[field.key]) : row.data[field.key],
    ])),
  };
}

async function* streamReportFillRecords(query: ReportFillRecordsExportQuery) {
  const pageSize = 1000;
  for (let page = 1; ; page++) {
    const result = await listAdminReportFillRecords({ ...parseQuery(query), page, pageSize });
    for (const row of result.list) yield mapFillRecordRow(row);
    if (result.list.length < pageSize) break;
  }
}

export const reportFillRecordsExportDefinition = defineExport<ReportFillRecordsExportQuery, Record<string, unknown>>({
  entity: 'report.fill-records',
  moduleName: '报表填报',
  filenamePrefix: '填报记录',
  sheetName: '填报记录',
  sourcePath: '/report/fill-records',
  permissions: { export: 'report:fill:record:export', exportRaw: 'report:fill:record:export-raw', requireExportRawPermission: true },
  resolveColumns: async (query): Promise<ExportColumn[]> => {
    const fields = new Map<string, ExportColumn>();
    for (let page = 1; ; page++) {
      const result = await listAdminReportFillRecords({ ...parseQuery(query), page, pageSize: 1000 });
      if (result.total > 50000) throw new Error('填报记录超过导出上限，请收窄范围');
      for (const row of result.list) for (const field of flattenWorkflowValueFields(row.templateSchemaSnapshot.fields)) {
        const key = ['field', row.templateId, row.templateRevision, field.key].join('_');
        fields.set(key, { key, header: (row.templateName ?? row.templateId) + ' V' + row.templateRevision + ' · ' + field.label, sensitive: true, width: 24 });
      }
      if (result.list.length < 1000) break;
    }
    return [...reportFillRecordsExportDefinition.columns, ...fields.values()];
  },
  columns: [
    { key: 'id', header: '记录ID', type: 'number' },
    { key: 'templateId', header: '模板ID', type: 'number' },
    { key: 'submitterId', header: '提交人ID', type: 'number' },
    { key: 'status', header: '状态' },
    { key: 'templateName', header: '模板名称' },
    { key: 'submitterName', header: '提交人', sensitive: true },
    { key: 'businessData', header: '业务字段(JSON)', width: 60, sensitive: true },
    { key: 'templateRevision', header: '模板版本', type: 'number' },
    { key: 'submittedAt', header: '提交时间', type: 'datetime' },
    { key: 'reviewedAt', header: '审核时间', type: 'datetime' },
    { key: 'reviewedBy', header: '审核人ID', type: 'number' },
    { key: 'workflowInstanceId', header: '工作流实例ID', type: 'number' },
    { key: 'generatedDatasetId', header: '消费数据集ID', type: 'number' },
    { key: 'syncStatus', header: '消费同步状态' },
    { key: 'createdAt', header: '创建时间', type: 'datetime' },
    { key: 'updatedAt', header: '更新时间', type: 'datetime' },
  ],
  countRows: async (query) => (await listAdminReportFillRecords({
    ...parseQuery(query),
    page: 1,
    pageSize: 1,
  })).total,
  streamRows: (query) => streamReportFillRecords(query),
});
