import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { tenants } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { buildTenantsWhere, type TenantListFilter } from '../../../services/identity/tenants.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS, STATUS_ENUM_MAP } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '租户名称', width: 20 },
  { key: 'code', header: '租户编码', width: 16 },
  { key: 'contactName', header: '联系人', width: 14 },
  { key: 'contactPhone', header: '联系电话', width: 16, sensitive: true, maskKey: 'Tenant.contactPhone' },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_ENUM_MAP },
  { key: 'expireAt', header: '到期时间', width: 22, type: 'datetime' },
  { key: 'maxUsers', header: '最大用户数', width: 12, type: 'number' },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const tenantsExportDefinition = defineExport<TenantListFilter & Record<string, unknown>, Record<string, unknown>>({
  entity: 'system.tenants',
  moduleName: '租户管理',
  filenamePrefix: '租户列表',
  sourcePath: '/system/tenants',
  sheetName: '租户列表',
  permissions: { export: 'system:tenant:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  // 与列表页同源的筛选：页面把已提交条件透传到 query
  countRows: async (query) => db.$count(tenants, buildTenantsWhere(query)),
  streamRows: async (query) => {
    const where = buildTenantsWhere(query);
    return batchIterable((limit, offset) =>
      db.select().from(tenants).where(where).orderBy(desc(tenants.id)).limit(limit).offset(offset),
    );
  },
});
