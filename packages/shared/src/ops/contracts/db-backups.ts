import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createBackupSchema } from '../../platform/validation';
import { DB_BACKUP_STATUSES, DB_BACKUP_TYPES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const dbBackupSchema = z.object({
  id: z.int(),
  name: z.string(),
  type: z.enum(DB_BACKUP_TYPES),
  fileId: z.uuid().nullable().meta({ description: '备份产物的托管文件 ID；未完成或已清理为 null' }),
  fileSize: z.int().nullable(),
  status: z.enum(DB_BACKUP_STATUSES),
  tables: z.string().nullable().meta({ description: '备份包含的表清单（逗号分隔），全库备份为 null' }),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: z.int().nullable(),
  errorMessage: z.string().nullable(),
  ...auditFieldsSchema,
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DbBackup' });

export type DbBackup = z.infer<typeof dbBackupSchema>;

/** 创建备份的即时回执；任务在后台执行，进度经列表轮询 */
export const dbBackupCreatedSchema = z.object({
  id: z.int(),
  name: z.string(),
  status: z.literal('pending'),
}).meta({ id: 'DbBackupCreated' });

export type DbBackupCreated = z.infer<typeof dbBackupCreatedSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const dbBackupListQuery = paginationQuery.extend({
  status: z.enum(DB_BACKUP_STATUSES).optional(),
  type: z.enum(DB_BACKUP_TYPES).optional(),
});

export const dbBackupContract = defineContract('/api/db-backups', {
  list: op.get('/', { query: dbBackupListQuery, response: paginated(dbBackupSchema), summary: '数据库备份列表' }),
  create: op.post('/', { body: createBackupSchema, response: dbBackupCreatedSchema, summary: '创建数据库备份' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除数据库备份记录' }),
}, { tags: ['DbBackups'] });
