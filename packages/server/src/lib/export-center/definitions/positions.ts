import { asc } from 'drizzle-orm';
import { db } from '../../../db';
import { positions } from '../../../db/schema';
import { currentUser } from '../../context';
import { tenantCondition } from '../../tenant';
import { defineExport } from '../registry';
import { COMMON_STATUS_LABELS } from '@zenith/shared';
import type { ExportColumn } from '../types';

const STATUS_LABELS: Record<string, string> = COMMON_STATUS_LABELS;

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '岗位名称', width: 18 },
  { key: 'code', header: '岗位编码', width: 18 },
  { key: 'sort', header: '排序', width: 8, type: 'number' },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
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
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async () => db.$count(positions, tenantCondition(positions, currentUser())),
  streamRows: async () =>
    db.select().from(positions).where(tenantCondition(positions, currentUser())).orderBy(asc(positions.sort)),
});
