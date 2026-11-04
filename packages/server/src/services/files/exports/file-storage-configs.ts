import { asc, desc } from 'drizzle-orm';
import { db } from '../../../db/index';
import { fileStorageConfigs } from '../../../db/schema';
import { buildFileStorageConfigsWhere, type FileStorageConfigListFilter } from '../file-storage-configs.service';
import { defineExport } from '../../../lib/export-center/registry';
import { RETENTION_7_DAYS } from '../../../lib/export-center/presets';
import type { ExportColumn } from '../../../lib/export-center/types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '名称', width: 24 },
  { key: 'provider', header: '存储类型', width: 12 },
  { key: 'status', header: '状态', width: 10 },
  { key: 'isDefault', header: '是否默认', width: 10, type: 'boolean' },
  { key: 'basePath', header: '基础路径', width: 24 },
  { key: 'remark', header: '备注', width: 24 },
  { key: 'createdAt', header: '创建时间', width: 20, type: 'datetime' },
];

export const fileStorageConfigsExportDefinition = defineExport<FileStorageConfigListFilter & Record<string, unknown>, Record<string, unknown>>({
  entity: 'system.file-storage-configs',
  moduleName: '文件配置',
  filenamePrefix: '文件存储配置',
  sourcePath: '/system/file-configs',
  sheetName: '文件存储配置',
  permissions: { export: 'system:file:config' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => db.$count(fileStorageConfigs, buildFileStorageConfigsWhere(query)),
  streamRows: async (query) =>
    db.select().from(fileStorageConfigs).where(buildFileStorageConfigsWhere(query)).orderBy(desc(fileStorageConfigs.isDefault), asc(fileStorageConfigs.id)),
});
