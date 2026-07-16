import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, text, unique } from 'drizzle-orm/pg-core';
import { statusEnum } from './common';
import { auditColumns, tenants, users } from './core';

// ─── 邮件配置表 ──────────────────────────────────────────────────────────────
export const emailEncryptionEnum = pgEnum('email_encryption', ['none', 'ssl', 'tls']);

export const emailConfigs = pgTable('email_configs', {
  id: serial('id').primaryKey(),
  smtpHost: varchar('smtp_host', { length: 128 }).notNull().default(''),
  smtpPort: integer('smtp_port').notNull().default(465),
  smtpUser: varchar('smtp_user', { length: 128 }).notNull().default(''),
  smtpPassword: varchar('smtp_password', { length: 256 }).notNull().default(''),
  fromName: varchar('from_name', { length: 64 }).notNull().default('Zenith Admin'),
  fromEmail: varchar('from_email', { length: 128 }).notNull().default(''),
  encryption: emailEncryptionEnum('encryption').notNull().default('ssl'),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type EmailConfigRow = typeof emailConfigs.$inferSelect;

export type NewEmailConfig = typeof emailConfigs.$inferInsert;

// ─── 通知模块：邮件 / 短信 / 站内信 ────────────────────────────────────────────
// 通用枚举
export const smsProviderEnum = pgEnum('sms_provider', ['aliyun', 'tencent']);

export const sendStatusEnum = pgEnum('send_status', ['pending', 'success', 'failed']);

export const sendSourceEnum = pgEnum('send_source', ['manual', 'test', 'system', 'api']);

export const inAppMessageTypeEnum = pgEnum('in_app_message_type', ['info', 'success', 'warning', 'error']);

// ── 邮件模板 ────────────────────────────────────────────────────────────────
export const emailTemplates = pgTable('email_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  subject: varchar('subject', { length: 200 }).notNull(),
  content: text('content').notNull(),
  variables: text('variables'),
  status: statusEnum('status').default('enabled').notNull(),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type EmailTemplateRow = typeof emailTemplates.$inferSelect;

export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

// ── 邮件发送记录 ────────────────────────────────────────────────────────────
export const emailSendLogs = pgTable('email_send_logs', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
  toEmail: varchar('to_email', { length: 256 }).notNull(),
  subject: varchar('subject', { length: 200 }).notNull(),
  content: text('content').notNull(),
  status: sendStatusEnum('status').default('pending').notNull(),
  errorMsg: text('error_msg'),
  source: sendSourceEnum('source').default('manual').notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  ip: varchar('ip', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type EmailSendLogRow = typeof emailSendLogs.$inferSelect;

export type NewEmailSendLog = typeof emailSendLogs.$inferInsert;

// ── 短信服务商配置 ──────────────────────────────────────────────────────────
export const smsConfigs = pgTable('sms_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  provider: smsProviderEnum('provider').notNull(),
  accessKeyId: varchar('access_key_id', { length: 256 }).notNull().default(''),
  accessKeySecret: varchar('access_key_secret', { length: 512 }).notNull().default(''),
  region: varchar('region', { length: 64 }),
  signName: varchar('sign_name', { length: 64 }).notNull().default(''),
  isDefault: boolean('is_default').notNull().default(false),
  status: statusEnum('status').default('enabled').notNull(),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type SmsConfigRow = typeof smsConfigs.$inferSelect;

export type NewSmsConfig = typeof smsConfigs.$inferInsert;

// ── 短信模板 ────────────────────────────────────────────────────────────────
export const smsTemplates = pgTable('sms_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  templateCode: varchar('template_code', { length: 100 }).notNull().default(''),
  signName: varchar('sign_name', { length: 64 }),
  content: text('content').notNull(),
  variables: text('variables'),
  provider: smsProviderEnum('provider').notNull(),
  status: statusEnum('status').default('enabled').notNull(),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type SmsTemplateRow = typeof smsTemplates.$inferSelect;

export type NewSmsTemplate = typeof smsTemplates.$inferInsert;

// ── 短信发送记录 ────────────────────────────────────────────────────────────
export const smsSendLogs = pgTable('sms_send_logs', {
  id: serial('id').primaryKey(),
  configId: integer('config_id').references(() => smsConfigs.id, { onDelete: 'set null' }),
  templateId: integer('template_id').references(() => smsTemplates.id, { onDelete: 'set null' }),
  provider: smsProviderEnum('provider').notNull(),
  phone: varchar('phone', { length: 32 }).notNull(),
  content: text('content').notNull(),
  status: sendStatusEnum('status').default('pending').notNull(),
  errorMsg: text('error_msg'),
  bizId: varchar('biz_id', { length: 128 }),
  deliveryStatus: varchar('delivery_status', { length: 32 }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  source: sendSourceEnum('source').default('manual').notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  ip: varchar('ip', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type SmsSendLogRow = typeof smsSendLogs.$inferSelect;

export type NewSmsSendLog = typeof smsSendLogs.$inferInsert;

// ── 站内信模板 ──────────────────────────────────────────────────────────────
export const inAppTemplates = pgTable('in_app_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content').notNull(),
  type: inAppMessageTypeEnum('type').default('info').notNull(),
  variables: text('variables'),
  status: statusEnum('status').default('enabled').notNull(),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type InAppTemplateRow = typeof inAppTemplates.$inferSelect;

export type NewInAppTemplate = typeof inAppTemplates.$inferInsert;

// ── 站内信收件记录 ──────────────────────────────────────────────────────────
export const inAppMessages = pgTable('in_app_messages', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').references(() => inAppTemplates.id, { onDelete: 'set null' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content').notNull(),
  type: inAppMessageTypeEnum('type').default('info').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { withTimezone: true }),
  source: sendSourceEnum('source').default('system').notNull(),
  senderId: integer('sender_id').references(() => users.id, { onDelete: 'set null' }),
  /** 深链地址（站内路由，如 /workflow/pending?instanceId=1，点击消息跳转） */
  link: varchar('link', { length: 512 }),
  /** 系统消息幂等键；按收件人拼接后唯一 */
  dedupeKey: varchar('dedupe_key', { length: 192 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('in_app_messages_dedupe_key_unique').on(t.dedupeKey),
]);

export type InAppMessageRow = typeof inAppMessages.$inferSelect;

export type NewInAppMessage = typeof inAppMessages.$inferInsert;

// ─── 标签管理 ─────────────────────────────────────────────────────────────────
