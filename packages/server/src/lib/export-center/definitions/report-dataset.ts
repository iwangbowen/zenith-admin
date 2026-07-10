/**
 * 报表数据集导出定义（接入统一导出中心）。
 * 列结构动态：由数据集声明字段 + 计算字段决定（fields 为空时探测一行推断列）。
 * 数据来源 getDatasetData（含参数解析 / 计算字段 / 缓存）。xlsx + csv 均支持。
 */
import { ensureDatasetExists, getDatasetData } from '../../../services/report/report-dataset.service';
import { defineExport } from '../registry';
import type { ExportColumn, ExportColumnType } from '../types';
import { formatReportFieldValue } from '@zenith/shared';
import type { ReportField, ReportComputedField } from '@zenith/shared';

const EXPORT_MAX_ROWS = 5000;

interface ReportDatasetExportQuery extends Record<string, unknown> {
  datasetId: number;
  params?: Record<string, unknown>;
  limit?: number;
}

function pickQuery(query: Record<string, unknown>): { datasetId: number; params?: Record<string, unknown>; limit: number } {
  const datasetId = Number(query.datasetId);
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    throw new Error('缺少有效的数据集 ID');
  }
  const params = query.params && typeof query.params === 'object' && !Array.isArray(query.params)
    ? (query.params as Record<string, unknown>)
    : undefined;
  const limit = Math.max(1, Math.min(Number(query.limit) || EXPORT_MAX_ROWS, EXPORT_MAX_ROWS));
  return { datasetId, params, limit };
}

function mapFieldType(type?: string): ExportColumnType | undefined {
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  return undefined; // string / date 按文本原样输出，避免二次格式化
}

export const reportDatasetExportDefinition = defineExport<ReportDatasetExportQuery, Record<string, unknown>>({
  entity: 'report.dataset',
  moduleName: '报表数据集',
  filenamePrefix: '报表数据',
  sheetName: '数据',
  formats: ['xlsx', 'csv'],
  renderMode: 'table',
  permissions: {
    export: 'report:dataset:list',
  },
  execution: {
    mode: 'sync',
    syncMaxRows: EXPORT_MAX_ROWS,
  },
  columns: [],
  resolveColumns: async (query) => {
    const { datasetId, params, limit } = pickQuery(query);
    const row = await ensureDatasetExists(datasetId);
    const fields = (row.fields ?? []) as ReportField[];
    const computed = (row.computedFields ?? []) as ReportComputedField[];
    const declared = [
      ...fields.map((f) => ({ name: f.name, label: f.label, type: f.type as string | undefined })),
      ...computed.map((c) => ({ name: c.name, label: c.label, type: c.type as string | undefined })),
    ];
    let defs = declared;
    if (defs.length === 0) {
      const probe = await getDatasetData(datasetId, params, limit, { scene: 'export', sourceRefId: datasetId });
      defs = probe.fields.map((field) => ({ name: field.name, label: field.label, type: field.type as string | undefined }));
    }
    return defs.map<ExportColumn>((f) => ({
      key: f.name,
      header: f.label || f.name,
      width: 20,
      type: mapFieldType(f.type),
    }));
  },
  countRows: async (query) => {
    const { datasetId, params, limit } = pickQuery(query);
    const data = await getDatasetData(datasetId, params, limit, { scene: 'export', sourceRefId: datasetId });
    return data.total ?? data.rows.length;
  },
  streamRows: async (query) => {
    const { datasetId, params, limit } = pickQuery(query);
    const data = await getDatasetData(datasetId, params, limit, { scene: 'export', sourceRefId: datasetId });
    const fieldMap = new Map(data.fields.map((field) => [field.name, field]));
    return data.rows.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        const field = fieldMap.get(key);
        return [key, field?.format ? formatReportFieldValue(field, value) : value];
      }),
    ));
  },
});
