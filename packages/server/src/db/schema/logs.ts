import { pgTable, serial, varchar, timestamp, pgEnum, integer, text, smallint } from 'drizzle-orm/pg-core';
import { tenants } from './core';

// ─── 登录日志表 ─────────────────────────────────────────────────────────────────
export const loginStatusEnum = pgEnum('login_status', ['success', 'fail']);

export const loginEventTypeEnum = pgEnum('login_event_type', ['login', 'logout']);

export const loginLogs = pgTable('login_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }).notNull(),
  ip: varchar('ip', { length: 64 }),
  location: varchar('location', { length: 128 }),
  browser: varchar('browser', { length: 64 }),
  os: varchar('os', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  eventType: loginEventTypeEnum('event_type').notNull().default('login'),
  status: loginStatusEnum('status').notNull(),
  message: varchar('message', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  // 设备信息（登录时由前端上报）
  screenWidth: smallint('screen_width'),
  screenHeight: smallint('screen_height'),
  devicePixelRatio: varchar('device_pixel_ratio', { length: 8 }),
  gpu: varchar('gpu', { length: 256 }),
  cpuCores: smallint('cpu_cores'),
  memoryGb: varchar('memory_gb', { length: 8 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── 操作日志表 ─────────────────────────────────────────────────────────────────
export const operationLogs = pgTable('operation_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: varchar('username', { length: 32 }),
  module: varchar('module', { length: 64 }),
  description: varchar('description', { length: 256 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  path: varchar('path', { length: 256 }).notNull(),
  requestId: varchar('request_id', { length: 36 }),
  requestBody: varchar('request_body', { length: 4096 }),
  beforeData: text('before_data'),
  afterData: text('after_data'),
  responseCode: integer('response_code'),
  responseBody: text('response_body'),
  durationMs: integer('duration_ms'),
  ip: varchar('ip', { length: 64 }),
  location: varchar('location', { length: 128 }),
  userAgent: varchar('user_agent', { length: 512 }),
  os: varchar('os', { length: 64 }),
  browser: varchar('browser', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OperationLogRow = typeof operationLogs.$inferSelect;

export type NewOperationLog = typeof operationLogs.$inferInsert;

// ─── IP 访问控制拦截日志表 ───────────────────────────────────────────────────────
export const ipAccessLogs = pgTable('ip_access_logs', {
  id: serial('id').primaryKey(),
  ip: varchar('ip', { length: 64 }).notNull(),
  path: varchar('path', { length: 256 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  blockType: varchar('block_type', { length: 16 }).notNull(), // 'blacklist' | 'whitelist'
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IpAccessLogRow = typeof ipAccessLogs.$inferSelect;

export type NewIpAccessLog = typeof ipAccessLogs.$inferInsert;

// ════════════════════════════════════════════════════════════════════════════
// 数据分析 / 埋点 / 错误监控（对标 GA4 / PostHog / 神策 / Sentry，重构）
// ════════════════════════════════════════════════════════════════════════════
