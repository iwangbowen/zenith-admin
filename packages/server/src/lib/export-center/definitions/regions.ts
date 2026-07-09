import { asc } from 'drizzle-orm';
import { db } from '../../../db';
import { regions } from '../../../db/schema';
import { defineExport } from '../registry';
import { COMMON_STATUS_LABELS, REGION_LEVEL_LABELS } from '@zenith/shared';
import type { ExportColumn } from '../types';

const LEVEL_LABELS: Record<string, string> = REGION_LEVEL_LABELS;
const STATUS_LABELS: Record<string, string> = COMMON_STATUS_LABELS;

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '地区名称', width: 20 },
  { key: 'code', header: '区划代码', width: 14 },
  { key: 'level', header: '级别', width: 10, enumMap: LEVEL_LABELS },
  { key: 'parentCode', header: '父级代码', width: 14, transform: (v) => (v as string | null) ?? '—' },
  { key: 'sort', header: '排序', width: 8, type: 'number' },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const regionsExportDefinition = defineExport({
  entity: 'system.regions',
  moduleName: '地区管理',
  filenamePrefix: '地区列表',
  sourcePath: '/system/regions',
  sheetName: '地区列表',
  permissions: { export: 'system:region:export' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async () => db.$count(regions),
  streamRows: async () => db.select().from(regions).orderBy(asc(regions.sort), asc(regions.code)),
});
