import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, text, index, jsonb, real, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { auditColumns, tenants } from './core';

// ─── 系统监控指标采样（时序持久化，追加型）──────────────────────────────────────
// 由 pg-boss 定时任务（默认每分钟）将 metricsSampler 最新快照落库，用于历史趋势与容量规划。
// 各百分比字段范围 0-100；*Bps 字段为字节/秒。
export const systemMetricSamples = pgTable('system_metric_samples', {
  id: serial('id').primaryKey(),
  sampledAt: timestamp('sampled_at', { withTimezone: true }).notNull().defaultNow(),
  cpu: real('cpu').notNull().default(0),
  memory: real('memory').notNull().default(0),
  disk: real('disk').notNull().default(0),
  swap: real('swap').notNull().default(0),
  load1: real('load1').notNull().default(0),
  procCpu: real('proc_cpu').notNull().default(0),
  heap: real('heap').notNull().default(0),
  loopLag: real('loop_lag').notNull().default(0),
  qps: real('qps').notNull().default(0),
  errorRate: real('error_rate').notNull().default(0),
  netRxBps: real('net_rx_bps').notNull().default(0),
  netTxBps: real('net_tx_bps').notNull().default(0),
  diskReadBps: real('disk_read_bps').notNull().default(0),
  diskWriteBps: real('disk_write_bps').notNull().default(0),
}, (t) => [
  index('system_metric_samples_at_idx').on(t.sampledAt),
]);

export type SystemMetricSampleRow = typeof systemMetricSamples.$inferSelect;

export type NewSystemMetricSample = typeof systemMetricSamples.$inferInsert;

// ─── 监控告警规则 ──────────────────────────────────────────────────────────────
// 可监控的指标维度（与 system_metric_samples 字段对应；workflow* 为流程引擎健康指标，由引擎健康快照提供）
export const monitorMetricEnum = pgEnum('monitor_metric', [
  'cpu', 'memory', 'disk', 'swap', 'load1', 'procCpu', 'heap', 'loopLag', 'qps', 'errorRate', 'netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps',
  'workflowHealth', 'workflowBacklog', 'workflowDeadLetter', 'workflowFailureRate', 'workflowStuckRunning',
]);

export const monitorAlertOperatorEnum = pgEnum('monitor_alert_operator', ['gt', 'gte', 'lt', 'lte']);

export const monitorAlertLevelEnum = pgEnum('monitor_alert_level', ['info', 'warning', 'critical']);

export const monitorAlertStateEnum = pgEnum('monitor_alert_state', ['ok', 'firing']);

export const monitorAlertEventStatusEnum = pgEnum('monitor_alert_event_status', ['firing', 'resolved']);

export const monitorAlertRules = pgTable('monitor_alert_rules', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  metric: monitorMetricEnum('metric').notNull(),
  operator: monitorAlertOperatorEnum('operator').notNull().default('gt'),
  threshold: real('threshold').notNull(),
  /** 持续达标分钟数（0=瞬时触发，>0=持续超阈才触发，抑制毛刺）*/
  durationMinutes: integer('duration_minutes').notNull().default(0),
  level: monitorAlertLevelEnum('level').notNull().default('warning'),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  webhookUrl: varchar('webhook_url', { length: 512 }),
  recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
  /** 静默期分钟数：触发后该时间内不重复通知 */
  silenceMinutes: integer('silence_minutes').notNull().default(30),
  enabled: boolean('enabled').notNull().default(true),
  /** 运行态：ok / firing */
  state: monitorAlertStateEnum('state').notNull().default('ok'),
  breachingSince: timestamp('breaching_since', { withTimezone: true }),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  lastValue: real('last_value'),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('monitor_alert_rules_tenant_idx').on(t.tenantId),
  index('monitor_alert_rules_enabled_idx').on(t.enabled),
]);

export type MonitorAlertRuleRow = typeof monitorAlertRules.$inferSelect;

export type NewMonitorAlertRule = typeof monitorAlertRules.$inferInsert;

// ─── 监控告警记录（追加型日志）────────────────────────────────────────────────
export const monitorAlertEvents = pgTable('monitor_alert_events', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ruleId: integer('rule_id').references((): AnyPgColumn => monitorAlertRules.id, { onDelete: 'set null' }),
  ruleName: varchar('rule_name', { length: 128 }).notNull(),
  metric: monitorMetricEnum('metric').notNull(),
  level: monitorAlertLevelEnum('level').notNull().default('warning'),
  operator: monitorAlertOperatorEnum('operator').notNull(),
  threshold: real('threshold').notNull(),
  value: real('value').notNull(),
  status: monitorAlertEventStatusEnum('status').notNull().default('firing'),
  message: text('message').notNull(),
  notified: boolean('notified').notNull().default(false),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  index('monitor_alert_events_rule_idx').on(t.ruleId),
  index('monitor_alert_events_status_idx').on(t.status),
  index('monitor_alert_events_triggered_idx').on(t.triggeredAt),
  index('monitor_alert_events_tenant_idx').on(t.tenantId),
]);

export type MonitorAlertEventRow = typeof monitorAlertEvents.$inferSelect;

export type NewMonitorAlertEvent = typeof monitorAlertEvents.$inferInsert;

// ─── SSL 证书 ──────────────────────────────────────────────────────────────
export const sslCertTypeEnum = pgEnum('ssl_cert_type', ['self_signed', 'uploaded', 'letsencrypt']);

export const sslCertStatusEnum = pgEnum('ssl_cert_status', ['valid', 'expiring', 'expired', 'invalid']);

export const sslCertificates = pgTable('ssl_certificates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  domain: varchar('domain', { length: 256 }).notNull(),
  type: sslCertTypeEnum('type').notNull().default('self_signed'),
  certPath: varchar('cert_path', { length: 512 }),
  keyPath: varchar('key_path', { length: 512 }),
  certContent: text('cert_content'),
  keyContent: text('key_content'),
  issuer: varchar('issuer', { length: 256 }),
  subject: varchar('subject', { length: 256 }),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  fingerprint: varchar('fingerprint', { length: 128 }),
  serialNumber: varchar('serial_number', { length: 128 }),
  status: sslCertStatusEnum('status').notNull().default('valid'),
  autoRenew: boolean('auto_renew').notNull().default(false),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SslCertificateRow = typeof sslCertificates.$inferSelect;

export type NewSslCertificate = typeof sslCertificates.$inferInsert;
