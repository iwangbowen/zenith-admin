import { listReportAssetCatalog } from '../report-asset.service';
import { defineExport } from '../../../lib/export-center/registry';

interface ReportAssetsExportQuery extends Record<string, unknown> {
  keyword?: string;
  types?: string;
  lifecycle?: string;
  status?: string;
  ownerId?: number;
  folderId?: number;
  updatedStart?: string;
  updatedEnd?: string;
}

function parseQuery(query: ReportAssetsExportQuery) {
  const allowed = new Set(['datasource', 'dataset', 'dashboard', 'metric', 'print_template', 'fill_template', 'asset_template']);
  const types = typeof query.types === 'string'
    ? query.types.split(',').filter((item) => allowed.has(item))
    : undefined;
  return {
    keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
    types: types as Array<'datasource' | 'dataset' | 'dashboard' | 'metric' | 'print_template' | 'fill_template' | 'asset_template'> | undefined,
    lifecycle: typeof query.lifecycle === 'string' ? query.lifecycle : undefined,
    status: typeof query.status === 'string' ? query.status : undefined,
    ownerId: Number(query.ownerId) || undefined,
    folderId: Number(query.folderId) || undefined,
    updatedStart: typeof query.updatedStart === 'string' ? query.updatedStart : undefined,
    updatedEnd: typeof query.updatedEnd === 'string' ? query.updatedEnd : undefined,
  };
}

async function* streamReportAssets(query: ReportAssetsExportQuery) {
  const pageSize = 1000;
  for (let page = 1; ; page++) {
    const result = await listReportAssetCatalog({ ...parseQuery(query), page, pageSize });
    for (const row of result.list) yield { ...row };
    if (result.list.length < pageSize) break;
  }
}

export const reportAssetsExportDefinition = defineExport<ReportAssetsExportQuery, Record<string, unknown>>({
  entity: 'report.assets',
  moduleName: '报表资产',
  filenamePrefix: '报表资产目录',
  sheetName: '资产目录',
  permissions: { export: 'report:asset:export' },
  columns: [
    { key: 'resourceType', header: '资产类型' },
    { key: 'resourceId', header: '资产ID', type: 'number' },
    { key: 'name', header: '名称' },
    { key: 'ownerName', header: '负责人' },
    { key: 'folderName', header: '目录' },
    { key: 'lifecycleStatus', header: '生命周期' },
    { key: 'status', header: '状态' },
    { key: 'deprecationEffectiveAt', header: '弃用生效时间', type: 'datetime' },
    { key: 'updatedAt', header: '更新时间', type: 'datetime' },
  ],
  countRows: async (query) => (await listReportAssetCatalog({ ...parseQuery(query), page: 1, pageSize: 1 })).total,
  streamRows: (query) => streamReportAssets(query),
});
