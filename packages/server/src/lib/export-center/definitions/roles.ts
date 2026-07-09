import { asc } from 'drizzle-orm';
import { db } from '../../../db';
import { roles } from '../../../db/schema';
import { currentUser } from '../../context';
import { tenantCondition } from '../../tenant';
import { defineExport } from '../registry';
import { COMMON_STATUS_LABELS } from '@zenith/shared';
import type { ExportColumn } from '../types';

const STATUS_LABELS: Record<string, string> = COMMON_STATUS_LABELS;

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '角色名称', width: 18 },
  { key: 'code', header: '角色编码', width: 18 },
  { key: 'description', header: '描述', width: 30 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
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
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async () => db.$count(roles, tenantCondition(roles, currentUser())),
  streamRows: async () =>
    db.select().from(roles).where(tenantCondition(roles, currentUser())).orderBy(asc(roles.id)),
});
