import { check, integer, index, pgEnum, pgTable, primaryKey, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { LOGIN_EVENT_TYPES } from '@zenith/shared/identity';
import { tenantIdColumn } from './core';
import { idColumn } from './common';
import { entitySubjectRoleEnum } from './entity-relations';

// ─── 登录日志表 ─────────────────────────────────────────────────────────────────
export const loginStatusEnum = pgEnum('login_status', ['success', 'fail']);

export const loginEventTypeEnum = pgEnum('login_event_type', LOGIN_EVENT_TYPES);

export const loginLogs = pgTable('login_logs', {
  id: idColumn(),
  userId: integer(),
  username: varchar({ length: 64 }).notNull(),
  ip: varchar({ length: 64 }),
  location: varchar({ length: 128 }),
  browser: varchar({ length: 64 }),
  os: varchar({ length: 64 }),
  userAgent: varchar({ length: 512 }),
  eventType: loginEventTypeEnum().notNull().default('login'),
  status: loginStatusEnum().notNull(),
  message: varchar({ length: 256 }),
  tenantId: tenantIdColumn(),
  // 设备信息（登录时由前端上报）
  screenWidth: smallint(),
  screenHeight: smallint(),
  devicePixelRatio: varchar({ length: 8 }),
  gpu: varchar({ length: 256 }),
  cpuCores: smallint(),
  memoryGb: varchar({ length: 8 }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 列表 / 统计 / 仪表盘的热过滤都是「租户 + 时间范围（按时间倒序）」：
  // 复合索引同时覆盖单独按 tenant_id 的查找与外键级联，不再另留单列 tenant 索引
  index('login_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
  index('login_logs_created_at_idx').on(t.createdAt),
  index('login_logs_user_idx').on(t.userId),
  index('login_logs_status_idx').on(t.status),
]);

// ─── 操作日志表 ─────────────────────────────────────────────────────────────────
export const operationLogs = pgTable('operation_logs', {
  id: idColumn(),
  userId: integer(),
  username: varchar({ length: 32 }),
  // 模拟登录期间的实际操作人（管理员）；本人操作为 null
  impersonatorId: integer(),
  impersonatorName: varchar({ length: 32 }),
  module: varchar({ length: 64 }),
  description: varchar({ length: 256 }).notNull(),
  method: varchar({ length: 16 }).notNull(),
  path: varchar({ length: 256 }).notNull(),
  requestId: varchar({ length: 36 }),
  requestBody: varchar({ length: 4096 }),
  beforeData: text(),
  afterData: text(),
  responseCode: integer(),
  responseBody: text(),
  durationMs: integer(),
  ip: varchar({ length: 64 }),
  location: varchar({ length: 128 }),
  userAgent: varchar({ length: 512 }),
  os: varchar({ length: 64 }),
  browser: varchar({ length: 64 }),
  tenantId: tenantIdColumn(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 同 login_logs：租户 + 时间范围复合索引取代单列 tenant 索引
  index('operation_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
  index('operation_logs_created_at_idx').on(t.createdAt),
  index('operation_logs_user_idx').on(t.userId),
  index('operation_logs_impersonator_idx').on(t.impersonatorId),
  index('operation_logs_module_idx').on(t.module),
  // 链路追踪查看器按 request_id（= traceId）定位请求锚点
  index('operation_logs_request_idx').on(t.requestId),
  // pg_trgm：加速「变更内容包含」ILIKE 模糊检索（扩展在 0001_extensions.sql 已启用）
  index('operation_logs_before_trgm_idx').using('gin', t.beforeData.op('gin_trgm_ops')),
  index('operation_logs_after_trgm_idx').using('gin', t.afterData.op('gin_trgm_ops')),
  index('operation_logs_reqbody_trgm_idx').using('gin', t.requestBody.op('gin_trgm_ops')),
]);

export type OperationLogRow = typeof operationLogs.$inferSelect;

export type NewOperationLog = typeof operationLogs.$inferInsert;

/**
 * Structured entity references for an operation log.
 *
 * A single operation may affect several objects (for example an order and a
 * refund, or a batch of users), so the subject identity is kept in a child
 * table instead of overloading operation_logs with one resource column.
 */
export const operationLogSubjects = pgTable('operation_log_subjects', {
  operationLogId: integer().notNull().references(() => operationLogs.id, { onDelete: 'cascade' }),
  tenantId: tenantIdColumn(),
  entityType: varchar({ length: 96 }).notNull(),
  entityKey: varchar({ length: 512 }).notNull(),
  role: entitySubjectRoleEnum().notNull().default('primary'),
}, (t) => [
  check('operation_log_subjects_entity_type_check', sql`length(${t.entityType}) > 0`),
  check('operation_log_subjects_entity_key_check', sql`length(${t.entityKey}) > 0`),
  primaryKey({ columns: [t.operationLogId, t.entityType, t.entityKey, t.role] }),
  index('operation_log_subjects_entity_idx').on(t.tenantId, t.entityType, t.entityKey, t.operationLogId),
  index('operation_log_subjects_log_idx').on(t.operationLogId),
]);

export type OperationLogSubjectRow = typeof operationLogSubjects.$inferSelect;
export type NewOperationLogSubject = typeof operationLogSubjects.$inferInsert;

// ─── IP 访问控制拦截日志表 ───────────────────────────────────────────────────────
export const ipAccessLogs = pgTable('ip_access_logs', {
  id: idColumn(),
  ip: varchar({ length: 64 }).notNull(),
  path: varchar({ length: 256 }).notNull(),
  method: varchar({ length: 16 }).notNull(),
  blockType: varchar({ length: 16 }).notNull(), // 'blacklist' | 'whitelist'
  userAgent: varchar({ length: 512 }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ip_access_logs_created_at_idx').on(t.createdAt),
  index('ip_access_logs_ip_idx').on(t.ip),
]);

export type IpAccessLogRow = typeof ipAccessLogs.$inferSelect;

export type NewIpAccessLog = typeof ipAccessLogs.$inferInsert;

// ════════════════════════════════════════════════════════════════════════════
// 数据分析 / 埋点 / 错误监控（对标 GA4 / PostHog / 神策 / Sentry，重构）
// ════════════════════════════════════════════════════════════════════════════
