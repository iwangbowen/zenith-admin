import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { tenants } from '../../../db/schema';
import { defineExport } from '../registry';
import { COMMON_STATUS_LABELS } from '@zenith/shared';
import type { ExportColumn } from '../types';

const STATUS_LABELS: Record<string, string> = COMMON_STATUS_LABELS;

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '租户名称', width: 20 },
  { key: 'code', header: '租户编码', width: 16 },
  { key: 'contactName', header: '联系人', width: 14 },
  { key: 'contactPhone', header: '联系电话', width: 16 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
  { key: 'expireAt', header: '到期时间', width: 22, type: 'datetime' },
  { key: 'maxUsers', header: '最大用户数', width: 12, type: 'number' },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const tenantsExportDefinition = defineExport({
  entity: 'system.tenants',
  moduleName: '租户管理',
  filenamePrefix: '租户列表',
  sourcePath: '/system/tenants',
  sheetName: '租户列表',
  permissions: { export: 'system:tenant:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async () => db.$count(tenants),
  streamRows: async () => db.select().from(tenants).orderBy(desc(tenants.id)),
});
