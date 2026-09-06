import { asc } from 'drizzle-orm';
import { roles } from '../../../db/schema';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS, STATUS_ENUM_MAP, tenantScopedTableSource } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '角色名称', width: 18 },
  { key: 'code', header: '角色编码', width: 18 },
  { key: 'description', header: '描述', width: 30 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_ENUM_MAP },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const rolesExportDefinition = defineExport({
  entity: 'system.roles',
  moduleName: '角色管理',
  filenamePrefix: '角色列表',
  sourcePath: '/system/roles',
  sheetName: '角色列表',
  permissions: { export: 'system:role:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  ...tenantScopedTableSource(roles, asc(roles.id)),
});
