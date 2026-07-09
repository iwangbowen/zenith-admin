import { asc } from 'drizzle-orm';
import { db } from '../../../db';
import { departments } from '../../../db/schema';
import { currentUser } from '../../context';
import { tenantCondition } from '../../tenant';
import { buildLeaderMap } from '../../../services/identity/departments.service';
import { defineExport } from '../registry';
import { COMMON_STATUS_LABELS } from '@zenith/shared';
import type { ExportColumn } from '../types';

const CATEGORY_LABELS: Record<string, string> = { group: '集团', company: '公司', department: '部门' };
const STATUS_LABELS: Record<string, string> = COMMON_STATUS_LABELS;

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '部门名称', width: 20 },
  { key: 'code', header: '部门编码', width: 16 },
  { key: 'category', header: '类别', width: 10, enumMap: CATEGORY_LABELS },
  { key: 'leaderName', header: '负责人', width: 14 },
  { key: 'phone', header: '电话', width: 16 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const departmentsExportDefinition = defineExport({
  entity: 'system.departments',
  moduleName: '部门管理',
  filenamePrefix: '部门列表',
  sourcePath: '/system/departments',
  sheetName: '部门列表',
  permissions: { export: 'system:department:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async () => db.$count(departments, tenantCondition(departments, currentUser())),
  streamRows: async () => {
    const rows = await db
      .select()
      .from(departments)
      .where(tenantCondition(departments, currentUser()))
      .orderBy(asc(departments.sort));
    const leaderIds = [...new Set(rows.map((r) => r.leaderId).filter((id): id is number => id !== null))];
    const leaderMap = await buildLeaderMap(leaderIds);
    return rows.map((r) => ({ ...r, leaderName: r.leaderId ? leaderMap.get(r.leaderId) ?? '' : '' }));
  },
});
