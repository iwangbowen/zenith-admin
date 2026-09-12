import { defineExport } from '../registry';
import { RETENTION_7_DAYS, STATUS_ENUM_MAP } from '../presets';
import { asString } from '../query-normalize';
import { REGION_LEVEL_LABELS, matchesRegionFilter } from '@zenith/shared/platform';
import { listRegionsFlat } from '../../../services/platform/regions.service';
import type { ExportColumn } from '../types';

const LEVEL_LABELS: Record<string, string> = REGION_LEVEL_LABELS;
const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '地区名称', width: 20 },
  { key: 'code', header: '区划代码', width: 14 },
  { key: 'level', header: '级别', width: 10, enumMap: LEVEL_LABELS },
  { key: 'parentCode', header: '父级代码', width: 14, transform: (v) => (v as string | null) ?? '—' },
  { key: 'sort', header: '排序', width: 8, type: 'number' },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_ENUM_MAP },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

/** 与地区树同源的筛选（关键字 / 状态 / 层级）；平铺导出只含命中行，不带祖先链 */
async function loadRows(query: Record<string, unknown>) {
  const filter = { keyword: asString(query.keyword), status: asString(query.status), level: asString(query.level) };
  return (await listRegionsFlat()).filter((r) => matchesRegionFilter(r, filter));
}

export const regionsExportDefinition = defineExport({
  entity: 'system.regions',
  moduleName: '地区管理',
  filenamePrefix: '地区列表',
  sourcePath: '/system/regions',
  sheetName: '地区列表',
  permissions: { export: 'system:region:export' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => (await loadRows(query)).length,
  streamRows: async (query) => loadRows(query),
});
