import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, unique, text, index, jsonb, uuid as pgUuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, tenants, users } from './core';
import { managedFiles } from './files';

export const exportJobFormatEnum = pgEnum('export_job_format', ['xlsx', 'csv']);

export const exportJobStatusEnum = pgEnum('export_job_status', ['pending', 'running', 'success', 'failed', 'cancelled', 'expired']);

export const exportJobExecutionModeEnum = pgEnum('export_job_execution_mode', ['sync', 'async']);

export const exportJobDeleteReasonEnum = pgEnum('export_job_delete_reason', ['expired', 'manual', 'file_missing']);

export const asyncTaskStatusEnum = pgEnum('async_task_status', ['pending', 'running', 'success', 'failed', 'cancelled']);

export const asyncTaskItemStatusEnum = pgEnum('async_task_item_status', ['pending', 'success', 'failed', 'skipped']);

// ─── 导出中心任务 ──────────────────────────────────────────────────────────────
export const exportJobs = pgTable('export_jobs', {
  id: serial('id').primaryKey(),
  entity: varchar('entity', { length: 64 }).notNull(),
  moduleName: varchar('module_name', { length: 64 }).notNull(),
  format: exportJobFormatEnum('format').notNull(),
  status: exportJobStatusEnum('status').notNull().default('pending'),
  executionMode: exportJobExecutionModeEnum('execution_mode').notNull().default('async'),
  query: jsonb('query').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  columns: jsonb('columns').$type<string[]>(),
  rowCount: integer('row_count'),
  fileId: pgUuid('file_id').references(() => managedFiles.id, { onDelete: 'set null' }),
  filename: varchar('filename', { length: 256 }),
  fileSize: integer('file_size'),
  raw: boolean('raw').notNull().default(false),
  masked: boolean('masked').notNull().default(true),
  sensitive: boolean('sensitive').notNull().default(false),
  watermark: boolean('watermark').notNull().default(true),
  errorMessage: text('error_message'),
  expiresAt: timestamp('expires_at'),
  fileDeletedAt: timestamp('file_deleted_at'),
  deleteReason: exportJobDeleteReasonEnum('delete_reason'),
  downloadCount: integer('download_count').notNull().default(0),
  lastDownloadedAt: timestamp('last_downloaded_at'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('export_jobs_entity_idx').on(t.entity),
  index('export_jobs_status_idx').on(t.status),
  index('export_jobs_created_by_idx').on(t.createdBy),
  index('export_jobs_tenant_idx').on(t.tenantId),
  index('export_jobs_expires_at_idx').on(t.expiresAt),
]);

export type ExportJobRow = typeof exportJobs.$inferSelect;

export type NewExportJob = typeof exportJobs.$inferInsert;

// ─── 任务中心（通用异步任务）────────────────────────────────────────────────────
export const asyncTasks = pgTable('async_tasks', {
  id: serial('id').primaryKey(),
  /** 任务类型标识，对应 lib/task-center 注册表中的 handler */
  taskType: varchar('task_type', { length: 64 }).notNull(),
  title: varchar('title', { length: 128 }).notNull(),
  status: asyncTaskStatusEnum('status').notNull().default('pending'),
  /** 任务入参（handler 自定义结构） */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** 总量；不可枚举的任务为 null（前端显示不定进度） */
  totalCount: integer('total_count'),
  processedCount: integer('processed_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  /** 当前进度说明（如「已处理 30/100 条」「阶段 2/3：汇总统计」） */
  progressNote: varchar('progress_note', { length: 256 }),
  /** 断点状态（handler 自定义结构），中断恢复时从这里续跑 */
  checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>(),
  /** 任务产出（handler 自定义结构） */
  result: jsonb('result').$type<Record<string, unknown>>(),
  errorMessage: text('error_message'),
  /** 协作式取消标记：running 任务由 handler 在处理间隙检查 */
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  /** 已领取执行次数（断点恢复不清零，重新开始清零） */
  attempts: integer('attempts').notNull().default(0),
  /** 最大执行次数快照（提交时从类型策略解析；失败且 attempts < maxAttempts 时自动重试） */
  maxAttempts: integer('max_attempts').notNull().default(1),
  /** 下次允许执行时间（自动重试退避）；null = 立即可执行 */
  nextRunAt: timestamp('next_run_at'),
  /** 幂等键：相同 key 的重复提交返回已存在任务 */
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  /** 执行心跳（progress 更新时刷新），兜底扫描据此回收卡死任务 */
  heartbeatAt: timestamp('heartbeat_at'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('async_tasks_type_idx').on(t.taskType),
  index('async_tasks_status_idx').on(t.status),
  index('async_tasks_created_by_idx').on(t.createdBy),
  index('async_tasks_created_at_idx').on(t.createdAt),
  unique('uniq_async_tasks_idempotency_key').on(t.idempotencyKey),
]);

export type AsyncTaskRow = typeof asyncTasks.$inferSelect;

export type NewAsyncTask = typeof asyncTasks.$inferInsert;

/** 任务项明细（可选层）：行级处理状态，导入/批量场景的逐行错误报告 */
export const asyncTaskItems = pgTable('async_task_items', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => asyncTasks.id, { onDelete: 'cascade' }),
  /** 业务标识（行号、用户ID、单号等），同一任务内唯一，重试时按 key 覆盖 */
  itemKey: varchar('item_key', { length: 128 }).notNull(),
  label: varchar('label', { length: 256 }),
  status: asyncTaskItemStatusEnum('status').notNull().default('pending'),
  /** 错误信息 / 备注 */
  message: text('message'),
  data: jsonb('data').$type<Record<string, unknown>>(),
  /** 在第几次执行中处理 */
  attempt: integer('attempt').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('uniq_async_task_item').on(t.taskId, t.itemKey),
  index('async_task_items_task_idx').on(t.taskId),
  index('async_task_items_task_status_idx').on(t.taskId, t.status),
]);

export type AsyncTaskItemRow = typeof asyncTaskItems.$inferSelect;

export type NewAsyncTaskItem = typeof asyncTaskItems.$inferInsert;

/** 任务类型运行时策略（注册时写入默认值，任务中心「任务类型」页可覆盖） */
export const asyncTaskTypeConfigs = pgTable('async_task_type_configs', {
  taskType: varchar('task_type', { length: 64 }).primaryKey(),
  /** false = 暂停提交（存量任务不受影响） */
  enabled: boolean('enabled').notNull().default(true),
  allowConcurrent: boolean('allow_concurrent').notNull().default(true),
  maxAttempts: integer('max_attempts').notNull().default(1),
  /** 重试退避基数（毫秒），实际延迟 = retryDelayMs * 2^(attempts-1)，上限 15 分钟 */
  retryDelayMs: integer('retry_delay_ms').notNull().default(5000),
  /** 已结束任务保留天数；null = 跟随全局（30 天） */
  retentionDays: integer('retention_days'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type AsyncTaskTypeConfigRow = typeof asyncTaskTypeConfigs.$inferSelect;

export const exportJobDownloads = pgTable('export_job_downloads', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => exportJobs.id, { onDelete: 'cascade' }),
  downloadedBy: integer('downloaded_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('export_job_downloads_job_idx').on(t.jobId),
  index('export_job_downloads_downloaded_by_idx').on(t.downloadedBy),
]);

export type ExportJobDownloadRow = typeof exportJobDownloads.$inferSelect;

export type NewExportJobDownload = typeof exportJobDownloads.$inferInsert;
