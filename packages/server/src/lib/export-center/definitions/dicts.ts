import { asc } from 'drizzle-orm';
import { db } from '../../../db';
import { dicts } from '../../../db/schema';
import { currentUser } from '../../context';
import { tenantCondition } from '../../tenant';
import { defineExport } from '../registry';
import { COMMON_STATUS_LABELS } from '@zenith/shared';
import type { ExportColumn } from '../types';

const STATUS_LABELS: Record<string, string> = COMMON_STATUS_LABELS;

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '字典名称', width: 20 },
  { key: 'code', header: '字典编码', width: 20 },
  { key: 'remark', header: '备注', width: 30 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
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
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async () => db.$count(dicts, tenantCondition(dicts, currentUser())),
  streamRows: async () =>
    db.select().from(dicts).where(tenantCondition(dicts, currentUser())).orderBy(asc(dicts.id)),
});
