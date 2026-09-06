import { asc } from 'drizzle-orm';
import { dicts } from '../../../db/schema';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS, STATUS_ENUM_MAP, tenantScopedTableSource } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '字典名称', width: 20 },
  { key: 'code', header: '字典编码', width: 20 },
  { key: 'remark', header: '备注', width: 30 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_ENUM_MAP },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const dictsExportDefinition = defineExport({
  entity: 'system.dicts',
  moduleName: '字典管理',
  filenamePrefix: '字典列表',
  sourcePath: '/system/dicts',
  sheetName: '字典列表',
  permissions: { export: 'system:dict:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  ...tenantScopedTableSource(dicts, asc(dicts.id)),
});
