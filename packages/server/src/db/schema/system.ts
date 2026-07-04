import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, unique, text, index, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { statusEnum } from './common';
import { auditColumns, tenants, users } from './core';

export const systemSchedulerTaskTypeEnum = pgEnum('system_scheduler_task_type', ['recurring', 'queue']);

export const systemSchedulerRunStatusEnum = pgEnum('system_scheduler_run_status', ['running', 'success', 'failed']);

export const systemSchedulerTriggerTypeEnum = pgEnum('system_scheduler_trigger_type', ['schedule', 'manual', 'queue']);

// ─── 系统参数配置表 ──────────────────────────────────────────────────────────
export const configTypeEnum = pgEnum('config_type', ['string', 'number', 'boolean', 'json']);

export const systemConfigs = pgTable('system_configs', {
  id: serial('id').primaryKey(),
  configKey: varchar('config_key', { length: 128 }).notNull(),
  configValue: varchar('config_value', { length: 4096 }).notNull().default(''),
  configType: configTypeEnum('config_type').notNull().default('string'),
  description: varchar('description', { length: 256 }).notNull().default(''),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('system_configs_tenant_key_unique').on(t.tenantId, t.configKey)]);

export type SystemConfigRow = typeof systemConfigs.$inferSelect;

export type NewSystemConfig = typeof systemConfigs.$inferInsert;

// ─── 定时任务表 ──────────────────────────────────────────────────────────────
export const cronRunStatusEnum = pgEnum('cron_run_status', ['success', 'fail', 'running']);

export const cronJobs = pgTable('cron_jobs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  cronExpression: varchar('cron_expression', { length: 128 }).notNull(),
  handler: varchar('handler', { length: 128 }).notNull(),
  params: text('params'),
  status: statusEnum('status').notNull().default('disabled'),
  description: varchar('description', { length: 256 }).notNull().default(''),
  retryCount: integer('retry_count').notNull().default(0),
  /** 重试间隔，单位：秒 */
  retryInterval: integer('retry_interval').notNull().default(0),
  /** 是否启用指数退避重试（每次翻倍延迟） */
  retryBackoff: boolean('retry_backoff').notNull().default(false),
  monitorTimeout: integer('monitor_timeout'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: cronRunStatusEnum('last_run_status'),
  lastRunMessage: varchar('last_run_message', { length: 1024 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CronJobRow = typeof cronJobs.$inferSelect;

export type NewCronJob = typeof cronJobs.$inferInsert;

// ─── 定时任务执行日志表 ────────────────────────────────────────────────────────
export const cronJobLogs = pgTable('cron_job_logs', {
  id:             serial('id').primaryKey(),
  jobId:          integer('job_id').notNull().references(() => cronJobs.id, { onDelete: 'cascade' }),
  jobName:        varchar('job_name', { length: 64 }).notNull(),
  executionCount: integer('execution_count').notNull().default(1),
  startedAt:      timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt:        timestamp('ended_at', { withTimezone: true }),
  durationMs:     integer('duration_ms'),
  status:         cronRunStatusEnum('status').notNull().default('running'),
  output:         text('output'),
});

export type CronJobLogRow = typeof cronJobLogs.$inferSelect;

export type NewCronJobLog = typeof cronJobLogs.$inferInsert;

// ─── 系统调度运行日志表（启动时注册的系统级任务 / 队列 Worker）─────────────────────
export const systemSchedulerRuns = pgTable('system_scheduler_runs', {
  id: serial('id').primaryKey(),
  taskName: varchar('task_name', { length: 128 }).notNull(),
  taskTitle: varchar('task_title', { length: 128 }).notNull(),
  taskType: systemSchedulerTaskTypeEnum('task_type').notNull(),
  module: varchar('module', { length: 64 }).notNull().default('系统'),
  triggerType: systemSchedulerTriggerTypeEnum('trigger_type').notNull(),
  status: systemSchedulerRunStatusEnum('status').notNull().default('running'),
  jobId: varchar('job_id', { length: 128 }),
  nodeId: varchar('node_id', { length: 128 }),
  nodeHostname: varchar('node_hostname', { length: 128 }),
  nodePid: integer('node_pid'),
  triggeredBy: integer('triggered_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  resultMessage: text('result_message'),
  errorMessage: text('error_message'),
  alertedAt: timestamp('alerted_at', { withTimezone: true }),
  alertMessage: text('alert_message'),
  alertSentAt: timestamp('alert_sent_at', { withTimezone: true }),
  alertChannels: jsonb('alert_channels').$type<Array<'inapp' | 'email' | 'webhook'>>().notNull().default([]),
  alertAckAt: timestamp('alert_ack_at', { withTimezone: true }),
  alertAckBy: integer('alert_ack_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  alertAckNote: text('alert_ack_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('system_scheduler_runs_task_idx').on(t.taskName),
  index('system_scheduler_runs_status_idx').on(t.status),
  index('system_scheduler_runs_started_at_idx').on(t.startedAt),
  index('system_scheduler_runs_triggered_by_idx').on(t.triggeredBy),
  index('system_scheduler_runs_alert_ack_by_idx').on(t.alertAckBy),
]);

export type SystemSchedulerRunRow = typeof systemSchedulerRuns.$inferSelect;

export type NewSystemSchedulerRun = typeof systemSchedulerRuns.$inferInsert;

// ─── 系统调度任务配置表（启动时注册任务的运行策略）───────────────────────────────
export const systemSchedulerTaskConfigs = pgTable('system_scheduler_task_configs', {
  taskName: varchar('task_name', { length: 128 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  logRetentionDays: integer('log_retention_days').notNull().default(30),
  logRetentionRuns: integer('log_retention_runs').notNull().default(1000),
  timeoutMs: integer('timeout_ms'),
  failureAlertThreshold: integer('failure_alert_threshold').notNull().default(1),
  alertEnabled: boolean('alert_enabled').notNull().default(true),
  alertChannels: jsonb('alert_channels').$type<Array<'inapp' | 'email' | 'webhook'>>().notNull().default(['inapp']),
  alertUserIds: jsonb('alert_user_ids').$type<number[]>().notNull().default([]),
  alertEmails: jsonb('alert_emails').$type<string[]>().notNull().default([]),
  alertWebhookUrl: varchar('alert_webhook_url', { length: 512 }),
  manualSingleton: boolean('manual_singleton').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type SystemSchedulerTaskConfigRow = typeof systemSchedulerTaskConfigs.$inferSelect;

export type NewSystemSchedulerTaskConfig = typeof systemSchedulerTaskConfigs.$inferInsert;

// ─── 系统调度节点心跳表 ───────────────────────────────────────────────────────
export const systemSchedulerNodes = pgTable('system_scheduler_nodes', {
  nodeId: varchar('node_id', { length: 128 }).primaryKey(),
  hostname: varchar('hostname', { length: 128 }).notNull(),
  pid: integer('pid').notNull(),
  version: varchar('version', { length: 64 }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull(),
  registeredTaskCount: integer('registered_task_count').notNull().default(0),
  runningJobCount: integer('running_job_count').notNull().default(0),
  active: boolean('active').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('system_scheduler_nodes_active_idx').on(t.active),
  index('system_scheduler_nodes_last_heartbeat_idx').on(t.lastHeartbeatAt),
]);

export type SystemSchedulerNodeRow = typeof systemSchedulerNodes.$inferSelect;

export type NewSystemSchedulerNode = typeof systemSchedulerNodes.$inferInsert;

// ─── 地区表 ──────────────────────────────────────────────────────────────────
export const regionLevelEnum = pgEnum('region_level', ['province', 'city', 'county']);

export const regions = pgTable('regions', {
  id:         serial('id').primaryKey(),
  code:       varchar('code', { length: 12 }).notNull().unique(),
  name:       varchar('name', { length: 64 }).notNull(),
  level:      regionLevelEnum('level').notNull(),
  parentCode: varchar('parent_code', { length: 12 }),
  sort:       integer('sort').notNull().default(0),
  status:     statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
});

export type RegionRow = typeof regions.$inferSelect;

export type NewRegion = typeof regions.$inferInsert;

// ─── 维护模式（单例，id 固定为 1）───────────────────────────────────────────
export const maintenanceMode = pgTable('maintenance_mode', {
  id: serial('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  message: varchar('message', { length: 512 }).notNull().default('系统维护中，请稍后重试'),
  estimatedEndAt: timestamp('estimated_end_at'),
  startedAt: timestamp('started_at'),
  startedByName: varchar('started_by_name', { length: 64 }),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type MaintenanceModeRow = typeof maintenanceMode.$inferSelect;

export type NewMaintenanceMode = typeof maintenanceMode.$inferInsert;

// ─── 维护记录（每次「开启→关闭」为一条维护时段）─────────────────────────────
export const maintenanceLogs = pgTable('maintenance_logs', {
  id: serial('id').primaryKey(),
  message: varchar('message', { length: 512 }).notNull(),
  estimatedEndAt: timestamp('estimated_end_at'),
  startedAt: timestamp('started_at').notNull(),
  startedById: integer('started_by_id'),
  startedByName: varchar('started_by_name', { length: 64 }),
  endedAt: timestamp('ended_at'),
  endedById: integer('ended_by_id'),
  endedByName: varchar('ended_by_name', { length: 64 }),
  durationSeconds: integer('duration_seconds'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('maintenance_logs_started_at_idx').on(t.startedAt),
  index('maintenance_logs_ended_at_idx').on(t.endedAt),
]);

export type MaintenanceLogRow = typeof maintenanceLogs.$inferSelect;

export type NewMaintenanceLog = typeof maintenanceLogs.$inferInsert;
