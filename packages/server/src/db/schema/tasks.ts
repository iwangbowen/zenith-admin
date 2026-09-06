import { timestampColumns } from './common';
import { pgTable, varchar, timestamp, pgEnum, integer, boolean, unique, uniqueIndex, text, index, jsonb, uuid as pgUuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, tenants, users } from './core';
import { managedFiles } from './files';
import { EXPORT_JOB_FORMATS } from '@zenith/shared/tasks';

export const exportJobFormatEnum = pgEnum('export_job_format', EXPORT_JOB_FORMATS);

export const exportJobStatusEnum = pgEnum('export_job_status', ['pending', 'running', 'success', 'failed', 'cancelled', 'expired']);

export const exportJobExecutionModeEnum = pgEnum('export_job_execution_mode', ['sync', 'async']);

export const exportJobDeleteReasonEnum = pgEnum('export_job_delete_reason', ['expired', 'manual', 'file_missing']);

export const asyncTaskStatusEnum = pgEnum('async_task_status', ['pending', 'running', 'success', 'failed', 'cancelled']);

export const asyncTaskItemStatusEnum = pgEnum('async_task_item_status', ['pending', 'success', 'failed', 'skipped']);

// ─── 导出中心任务 ──────────────────────────────────────────────────────────────
export const exportJobs = pgTable('export_jobs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  entity: varchar({ length: 64 }).notNull(),
  moduleName: varchar({ length: 64 }).notNull(),
  format: exportJobFormatEnum().notNull(),
  status: exportJobStatusEnum().notNull().default('pending'),
  executionMode: exportJobExecutionModeEnum().notNull().default('async'),
  query: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  columns: jsonb().$type<string[]>(),
  rowCount: integer(),
  fileId: pgUuid().references(() => managedFiles.id, { onDelete: 'set null' }),
  filename: varchar({ length: 256 }),
  fileSize: integer(),
  raw: boolean().notNull().default(false),
  masked: boolean().notNull().default(true),
  sensitive: boolean().notNull().default(false),
  watermark: boolean().notNull().default(true),
  errorMessage: text(),
  expiresAt: timestamp(),
  fileDeletedAt: timestamp(),
  deleteReason: exportJobDeleteReasonEnum(),
  downloadCount: integer().notNull().default(0),
  lastDownloadedAt: timestamp(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  startedAt: timestamp(),
  completedAt: timestamp(),
  ...timestampColumns(),
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
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 任务类型标识，对应 lib/task-center 注册表中的 handler */
  taskType: varchar({ length: 64 }).notNull(),
  title: varchar({ length: 128 }).notNull(),
  status: asyncTaskStatusEnum().notNull().default('pending'),
  /** 任务入参（handler 自定义结构） */
  payload: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** 总量；不可枚举的任务为 null（前端显示不定进度） */
  totalCount: integer(),
  processedCount: integer().notNull().default(0),
  failedCount: integer().notNull().default(0),
  /** 当前进度说明（如「已处理 30/100 条」「阶段 2/3：汇总统计」） */
  progressNote: varchar({ length: 256 }),
  /** 断点状态（handler 自定义结构），中断恢复时从这里续跑 */
  checkpoint: jsonb().$type<Record<string, unknown>>(),
  /** 任务产出（handler 自定义结构） */
  result: jsonb().$type<Record<string, unknown>>(),
  errorMessage: text(),
  /** 协作式取消标记：running 任务由 handler 在处理间隙检查 */
  cancelRequested: boolean().notNull().default(false),
  /** 已领取执行次数（断点恢复不清零，重新开始清零） */
  attempts: integer().notNull().default(0),
  /** 最大执行次数快照（提交时从类型策略解析；失败且 attempts < maxAttempts 时自动重试） */
  maxAttempts: integer().notNull().default(1),
  /** 下次允许执行时间（自动重试退避）；null = 立即可执行 */
  nextRunAt: timestamp(),
  /**
   * 幂等键：相同 key 的重复提交返回已存在任务。
   *
   * 作用域是 (tenant_id, created_by, task_type, idempotency_key)，见下方唯一索引——
   * 此前是单列全局唯一，任意租户的任意用户只要撞上 key 就能拿回别人的任务行
   * （含 payload / result）。
   */
  idempotencyKey: varchar({ length: 128 }),
  /** 执行心跳（progress 更新时刷新），兜底扫描据此回收卡死任务 */
  heartbeatAt: timestamp(),
  /** 链路关联 ID（= 提交请求的 requestId），串起任务与其触发源/后续副作用 */
  traceId: varchar({ length: 64 }),
  /** 因果父引用（`kind:refId` 或 `request`），链路时间线树形展示的触发源 */
  parentRef: varchar({ length: 32 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  startedAt: timestamp(),
  completedAt: timestamp(),
  ...timestampColumns(),
}, (t) => [
  index('async_tasks_type_idx').on(t.taskType),
  index('async_tasks_status_idx').on(t.status),
  index('async_tasks_created_by_idx').on(t.createdBy),
  index('async_tasks_created_at_idx').on(t.createdAt),
  index('async_tasks_trace_idx').on(t.traceId),
  // payload / result 内容检索：jsonb 需先转 text 再挂 gin_trgm_ops
  // （pg_trgm 扩展由迁移基线 0000 顶部创建）
  index('async_tasks_payload_trgm_idx').using('gin', sql`(${t.payload}::text) gin_trgm_ops`),
  index('async_tasks_result_trgm_idx').using('gin', sql`(${t.result}::text) gin_trgm_ops`),
  // 幂等键限定在「租户 + 提交人 + 任务类型」内唯一。
  // tenant_id 可空（单租户模式恒为 null，多租户下平台级任务也为 null），而 PG 唯一约束
  // 视 NULL 互不相等，直接建复合约束会让平台级任务的幂等彻底失效；故拆成互补的两个
  // 部分索引（与 analytics_user_segments_{tenant,global}_name_uq 同一手法）。
  uniqueIndex('async_tasks_idem_tenant_uq')
    .on(t.tenantId, t.createdBy, t.taskType, t.idempotencyKey)
    .where(sql`${t.idempotencyKey} is not null and ${t.tenantId} is not null`),
  uniqueIndex('async_tasks_idem_platform_uq')
    .on(t.createdBy, t.taskType, t.idempotencyKey)
    .where(sql`${t.idempotencyKey} is not null and ${t.tenantId} is null`),
]);

export type AsyncTaskRow = typeof asyncTasks.$inferSelect;

export type NewAsyncTask = typeof asyncTasks.$inferInsert;

/** 任务项明细（可选层）：行级处理状态，导入/批量场景的逐行错误报告 */
export const asyncTaskItems = pgTable('async_task_items', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  taskId: integer().notNull().references(() => asyncTasks.id, { onDelete: 'cascade' }),
  /** 业务标识（行号、用户ID、单号等），同一任务内唯一，重试时按 key 覆盖 */
  itemKey: varchar({ length: 128 }).notNull(),
  label: varchar({ length: 256 }),
  status: asyncTaskItemStatusEnum().notNull().default('pending'),
  /** 错误信息 / 备注 */
  message: text(),
  data: jsonb().$type<Record<string, unknown>>(),
  /** 在第几次执行中处理 */
  attempt: integer().notNull().default(1),
  ...timestampColumns(),
}, (t) => [
  unique('uniq_async_task_item').on(t.taskId, t.itemKey),
  index('async_task_items_task_idx').on(t.taskId),
  index('async_task_items_task_status_idx').on(t.taskId, t.status),
]);

export type AsyncTaskItemRow = typeof asyncTaskItems.$inferSelect;

export type NewAsyncTaskItem = typeof asyncTaskItems.$inferInsert;

/** 任务类型运行时策略（注册时写入默认值，任务中心「任务类型」页可覆盖） */
export const asyncTaskTypeConfigs = pgTable('async_task_type_configs', {
  taskType: varchar({ length: 64 }).primaryKey(),
  /** false = 暂停提交（存量任务不受影响） */
  enabled: boolean().notNull().default(true),
  allowConcurrent: boolean().notNull().default(true),
  maxAttempts: integer().notNull().default(1),
  /** 重试退避基数（毫秒），实际延迟 = retryDelayMs * 2^(attempts-1)，上限 15 分钟 */
  retryDelayMs: integer().notNull().default(5000),
  /** 已结束任务保留天数；null = 跟随全局（30 天） */
  retentionDays: integer(),
  ...timestampColumns(),
});

export type AsyncTaskTypeConfigRow = typeof asyncTaskTypeConfigs.$inferSelect;

export const exportJobDownloads = pgTable('export_job_downloads', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  jobId: integer().notNull().references(() => exportJobs.id, { onDelete: 'cascade' }),
  downloadedBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ip: varchar({ length: 64 }),
  userAgent: varchar({ length: 512 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('export_job_downloads_tenant_idx').on(t.tenantId), 
  index('export_job_downloads_job_idx').on(t.jobId),
  index('export_job_downloads_downloaded_by_idx').on(t.downloadedBy),
]);

export type ExportJobDownloadRow = typeof exportJobDownloads.$inferSelect;

export type NewExportJobDownload = typeof exportJobDownloads.$inferInsert;
