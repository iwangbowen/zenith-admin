import { pgTable, varchar, timestamp, pgEnum, integer, boolean, unique, text, index, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { statusEnum } from './common';
import { auditColumns, tenants, users } from './core';

export const systemSchedulerTaskTypeEnum = pgEnum('system_scheduler_task_type', ['recurring', 'queue']);

export const systemSchedulerRunStatusEnum = pgEnum('system_scheduler_run_status', ['running', 'success', 'failed']);

export const systemSchedulerTriggerTypeEnum = pgEnum('system_scheduler_trigger_type', ['schedule', 'manual', 'queue']);

// ─── 运行时设置 ──────────────────────────────────────────────────────────────
/**
 * 运行时设置：一行 = 一个模块（`@zenith/shared/settings` 注册表的 key）在一个作用域的**显式覆盖**，
 * `data` 是稀疏文档，缺失字段继承上级（租户行 → 平台行 → schema 默认值）。
 * 读写一律经 `lib/settings`，禁止业务代码直查本表；写入触发 `cache_invalidate` 通知（触发器见 0001_extensions.sql）。
 */
export const systemSettings = pgTable('system_settings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  module: varchar({ length: 64 }).notNull(),
  /** null = 平台级 */
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  /** 乐观锁版本：每次保存 +1；客户端携带的 version 不一致时拒绝（409） */
  version: integer().notNull().default(1),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  // NULLS NOT DISTINCT（PG15+）：平台行 (module, NULL) 同样受唯一约束，ON CONFLICT 可直接以 (module, tenant_id) 为目标
  unique('system_settings_module_tenant_unique').on(t.module, t.tenantId).nullsNotDistinct(),
]);

export type SystemSettingsRow = typeof systemSettings.$inferSelect;

/**
 * 进程维护的运行时状态（非人工配置）：CMS 主题指纹等机器写入的键值。
 * 与 `system_settings` 分离，避免机器写入触发设置失效广播、混入审计与设置页面。
 */
export const systemRuntimeState = pgTable('system_runtime_state', {
  key: varchar({ length: 128 }).primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type SystemRuntimeStateRow = typeof systemRuntimeState.$inferSelect;

// ─── 定时任务表 ──────────────────────────────────────────────────────────────
export const cronRunStatusEnum = pgEnum('cron_run_status', ['success', 'fail', 'running']);

export const cronJobs = pgTable('cron_jobs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull().unique(),
  cronExpression: varchar({ length: 128 }).notNull(),
  handler: varchar({ length: 128 }).notNull(),
  params: text(),
  status: statusEnum().notNull().default('disabled'),
  description: varchar({ length: 256 }).notNull().default(''),
  retryCount: integer().notNull().default(0),
  /** 重试间隔，单位：秒 */
  retryInterval: integer().notNull().default(0),
  /** 是否启用指数退避重试（每次翻倍延迟） */
  retryBackoff: boolean().notNull().default(false),
  monitorTimeout: integer(),
  lastRunAt: timestamp({ withTimezone: true }),
  lastRunStatus: cronRunStatusEnum(),
  lastRunMessage: varchar({ length: 1024 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CronJobRow = typeof cronJobs.$inferSelect;

export type NewCronJob = typeof cronJobs.$inferInsert;

// ─── 定时任务执行日志表 ────────────────────────────────────────────────────────
export const cronJobLogs = pgTable('cron_job_logs', {
  id:             integer().primaryKey().generatedAlwaysAsIdentity(),
  jobId:          integer().notNull().references(() => cronJobs.id, { onDelete: 'cascade' }),
  jobName:        varchar({ length: 64 }).notNull(),
  executionCount: integer().notNull().default(1),
  startedAt:      timestamp({ withTimezone: true }).defaultNow().notNull(),
  endedAt:        timestamp({ withTimezone: true }),
  durationMs:     integer(),
  status:         cronRunStatusEnum().notNull().default('running'),
  output:         text(),
}, (t) => [
  index('cron_job_logs_started_at_idx').on(t.startedAt),
  index('cron_job_logs_job_idx').on(t.jobId),
]);

export type CronJobLogRow = typeof cronJobLogs.$inferSelect;

export type NewCronJobLog = typeof cronJobLogs.$inferInsert;

// ─── 系统调度运行日志表（启动时注册的系统级任务 / 队列 Worker）─────────────────────
export const systemSchedulerRuns = pgTable('system_scheduler_runs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  taskName: varchar({ length: 128 }).notNull(),
  taskTitle: varchar({ length: 128 }).notNull(),
  taskType: systemSchedulerTaskTypeEnum().notNull(),
  module: varchar({ length: 64 }).notNull().default('系统'),
  triggerType: systemSchedulerTriggerTypeEnum().notNull(),
  status: systemSchedulerRunStatusEnum().notNull().default('running'),
  jobId: varchar({ length: 128 }),
  nodeId: varchar({ length: 128 }),
  nodeHostname: varchar({ length: 128 }),
  nodePid: integer(),
  triggeredBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp({ withTimezone: true }),
  durationMs: integer(),
  resultMessage: text(),
  errorMessage: text(),
  alertedAt: timestamp({ withTimezone: true }),
  alertMessage: text(),
  alertSentAt: timestamp({ withTimezone: true }),
  alertChannels: jsonb().$type<Array<'inapp' | 'email' | 'webhook'>>().notNull().default([]),
  alertAckAt: timestamp({ withTimezone: true }),
  alertAckBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  alertAckNote: text(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
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
  taskName: varchar({ length: 128 }).primaryKey(),
  enabled: boolean().notNull().default(true),
  logRetentionDays: integer().notNull().default(30),
  logRetentionRuns: integer().notNull().default(1000),
  timeoutMs: integer(),
  failureAlertThreshold: integer().notNull().default(1),
  alertEnabled: boolean().notNull().default(true),
  alertChannels: jsonb().$type<Array<'inapp' | 'email' | 'webhook'>>().notNull().default(['inapp']),
  alertUserIds: jsonb().$type<number[]>().notNull().default([]),
  alertEmails: jsonb().$type<string[]>().notNull().default([]),
  alertWebhookUrl: varchar({ length: 512 }),
  manualSingleton: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type SystemSchedulerTaskConfigRow = typeof systemSchedulerTaskConfigs.$inferSelect;

export type NewSystemSchedulerTaskConfig = typeof systemSchedulerTaskConfigs.$inferInsert;

// ─── 系统调度节点心跳表 ───────────────────────────────────────────────────────
export const systemSchedulerNodes = pgTable('system_scheduler_nodes', {
  nodeId: varchar({ length: 128 }).primaryKey(),
  hostname: varchar({ length: 128 }).notNull(),
  pid: integer().notNull(),
  version: varchar({ length: 64 }),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  lastHeartbeatAt: timestamp({ withTimezone: true }).notNull(),
  registeredTaskCount: integer().notNull().default(0),
  runningJobCount: integer().notNull().default(0),
  active: boolean().notNull().default(true),
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('system_scheduler_nodes_active_idx').on(t.active),
  index('system_scheduler_nodes_last_heartbeat_idx').on(t.lastHeartbeatAt),
]);

export type SystemSchedulerNodeRow = typeof systemSchedulerNodes.$inferSelect;

export type NewSystemSchedulerNode = typeof systemSchedulerNodes.$inferInsert;

// ─── 数据保留策略表 ───────────────────────────────────────────────────────────
// 策略清单由 `lib/retention/policies.ts` 以代码声明为准（SSOT）；本表只存放
// 管理员可调的运行期覆盖值与上次执行结果。启动注册时对已存在行不回写默认值，
// 因此管理员在后台改过的配置不会被重启覆盖。
export const retentionPolicies = pgTable('retention_policies', {
  policyKey: varchar({ length: 128 }).primaryKey(),
  enabled: boolean().notNull().default(true),
  /** 保留天数；0 表示不清理 */
  retentionDays: integer().notNull(),
  /** 单批删除行数上限 */
  batchSize: integer().notNull().default(5000),
  lastRunAt: timestamp({ withTimezone: true }),
  lastDeleted: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type RetentionPolicyRow = typeof retentionPolicies.$inferSelect;

export type NewRetentionPolicy = typeof retentionPolicies.$inferInsert;

// ─── 地区表 ──────────────────────────────────────────────────────────────────
export const regionLevelEnum = pgEnum('region_level', ['province', 'city', 'county']);

export const regions = pgTable('regions', {
  id:         integer().primaryKey().generatedAlwaysAsIdentity(),
  code:       varchar({ length: 12 }).notNull().unique(),
  name:       varchar({ length: 64 }).notNull(),
  level:      regionLevelEnum().notNull(),
  parentCode: varchar({ length: 12 }),
  sort:       integer().notNull().default(0),
  status:     statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  createdAt:  timestamp().defaultNow().notNull(),
  updatedAt:  timestamp().defaultNow().notNull(),
});

export type RegionRow = typeof regions.$inferSelect;

export type NewRegion = typeof regions.$inferInsert;

// ─── 维护模式（单例，id 固定为 1）───────────────────────────────────────────
export const maintenanceMode = pgTable('maintenance_mode', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  enabled: boolean().notNull().default(false),
  message: varchar({ length: 512 }).notNull().default('系统维护中，请稍后重试'),
  estimatedEndAt: timestamp(),
  startedAt: timestamp(),
  startedByName: varchar({ length: 64 }),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type MaintenanceModeRow = typeof maintenanceMode.$inferSelect;

export type NewMaintenanceMode = typeof maintenanceMode.$inferInsert;

// ─── 维护记录（每次「开启→关闭」为一条维护时段）─────────────────────────────
export const maintenanceLogs = pgTable('maintenance_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  message: varchar({ length: 512 }).notNull(),
  estimatedEndAt: timestamp(),
  startedAt: timestamp().notNull(),
  startedById: integer(),
  startedByName: varchar({ length: 64 }),
  endedAt: timestamp(),
  endedById: integer(),
  endedByName: varchar({ length: 64 }),
  durationSeconds: integer(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('maintenance_logs_started_at_idx').on(t.startedAt),
  index('maintenance_logs_ended_at_idx').on(t.endedAt),
]);

export type MaintenanceLogRow = typeof maintenanceLogs.$inferSelect;

export type NewMaintenanceLog = typeof maintenanceLogs.$inferInsert;

// ─── 意见反馈表 ──────────────────────────────────────────────────────────────
export const userFeedbackCategoryEnum = pgEnum('user_feedback_category', ['suggestion', 'bug', 'ux', 'other']);

export const userFeedbackStatusEnum = pgEnum('user_feedback_status', ['pending', 'processing', 'resolved', 'ignored']);

export const userFeedbacks = pgTable('user_feedbacks', {
  id:           integer().primaryKey().generatedAlwaysAsIdentity(),
  userId:       integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 满意度评分 1-5，可空（评分与内容至少其一） */
  score:        integer(),
  category:     userFeedbackCategoryEnum().notNull().default('suggestion'),
  content:      varchar({ length: 1000 }),
  /** 提交时所在页面路由，便于定位问题来源 */
  pagePath:     varchar({ length: 200 }),
  /** 提交时活跃的会话回放 ID（反馈联动：管理员可直接回看用户操作现场） */
  replayId:     varchar({ length: 36 }),
  status:       userFeedbackStatusEnum().notNull().default('pending'),
  handleRemark: varchar({ length: 500 }),
  handledBy:    integer().references(() => users.id, { onDelete: 'set null' }),
  handledAt:    timestamp(),
  createdAt:    timestamp().defaultNow().notNull(),
  updatedAt:    timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('user_feedbacks_status_idx').on(t.status),
  index('user_feedbacks_user_idx').on(t.userId),
  index('user_feedbacks_created_at_idx').on(t.createdAt),
]);

export type UserFeedbackRow = typeof userFeedbacks.$inferSelect;

export type NewUserFeedback = typeof userFeedbacks.$inferInsert;
