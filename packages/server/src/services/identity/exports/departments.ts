import { listDepartmentsFlat, matchesDepartmentFilter } from '../departments.service';
import { defineExport } from '../../../lib/export-center/registry';
import { RETENTION_7_DAYS, STATUS_ENUM_MAP } from '../../../lib/export-center/presets';
import { asString } from '../../../lib/export-center/query-normalize';
import type { ExportColumn } from '../../../lib/export-center/types';

const CATEGORY_LABELS: Record<string, string> = { group: '集团', company: '公司', department: '部门' };
const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '部门名称', width: 20 },
  { key: 'code', header: '部门编码', width: 16 },
  { key: 'category', header: '类别', width: 10, enumMap: CATEGORY_LABELS },
  { key: 'leaderName', header: '负责人', width: 14 },
  { key: 'phone', header: '电话', width: 16 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_ENUM_MAP },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

/** 与部门树同源：租户可见范围 + 页面筛选（关键字 / 状态）；平铺导出只含命中行，不带祖先链 */
async function loadRows(query: Record<string, unknown>) {
  const filter = { keyword: asString(query.keyword), status: asString(query.status) };
  return (await listDepartmentsFlat()).filter((d) => matchesDepartmentFilter(d, filter));
}

export const departmentsExportDefinition = defineExport({
  entity: 'system.departments',
  moduleName: '部门管理',
  filenamePrefix: '部门列表',
  sourcePath: '/system/departments',
  sheetName: '部门列表',
  permissions: { export: 'system:department:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => (await loadRows(query)).length,
  streamRows: async (query) => loadRows(query),
});
