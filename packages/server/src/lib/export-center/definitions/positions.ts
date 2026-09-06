import { asc } from 'drizzle-orm';
import { positions } from '../../../db/schema';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS, STATUS_ENUM_MAP, tenantScopedTableSource } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '岗位名称', width: 18 },
  { key: 'code', header: '岗位编码', width: 18 },
  { key: 'sort', header: '排序', width: 8, type: 'number' },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_ENUM_MAP },
  { key: 'remark', header: '备注', width: 24 },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const positionsExportDefinition = defineExport({
  entity: 'system.positions',
  moduleName: '岗位管理',
  filenamePrefix: '岗位列表',
  sourcePath: '/system/positions',
  sheetName: '岗位列表',
  permissions: { export: 'system:position:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  ...tenantScopedTableSource(positions, asc(positions.sort)),
});
