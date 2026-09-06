import { pgTable, varchar, timestamp, pgEnum, integer, boolean, text, unique, index, jsonb, uniqueIndex, smallint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DECISIONS,
  NOTIFICATION_DIGEST_MODES,
  NOTIFICATION_OUTBOX_STATUSES,
  NOTIFICATION_RECIPIENT_TYPES,
} from '@zenith/shared/messaging';
import type {
  NotificationChannelOptions,
  NotificationChannelPolicy,
  NotificationRecipient,
} from '@zenith/shared/messaging';
import { statusEnum, pushProviderEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';
import { clientApps } from './app-releases';

// ─── 邮件配置表 ──────────────────────────────────────────────────────────────
export const emailEncryptionEnum = pgEnum('email_encryption', ['none', 'ssl', 'tls']);

export const emailConfigs = pgTable('email_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  smtpHost: varchar({ length: 128 }).notNull().default(''),
  smtpPort: integer().notNull().default(465),
  smtpUser: varchar({ length: 128 }).notNull().default(''),
  smtpPassword: varchar({ length: 256 }).notNull().default(''),
  fromName: varchar({ length: 64 }).notNull().default('Zenith Admin'),
  fromEmail: varchar({ length: 128 }).notNull().default(''),
  encryption: emailEncryptionEnum().notNull().default('ssl'),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns(),
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
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 100 }).notNull().unique(),
  subject: varchar({ length: 200 }).notNull(),
  content: text().notNull(),
  variables: text(),
  status: statusEnum().default('enabled').notNull(),
  remark: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('email_templates_tenant_idx').on(t.tenantId)]);

export type EmailTemplateRow = typeof emailTemplates.$inferSelect;

export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

// ── 邮件发送记录 ────────────────────────────────────────────────────────────
export const emailSendLogs = pgTable('email_send_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  templateId: integer().references(() => emailTemplates.id, { onDelete: 'set null' }),
  toEmail: varchar({ length: 256 }).notNull(),
  subject: varchar({ length: 200 }).notNull(),
  content: text().notNull(),
  status: sendStatusEnum().default('pending').notNull(),
  errorMsg: text(),
  source: sendSourceEnum().default('manual').notNull(),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  ip: varchar({ length: 64 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  sentAt: timestamp({ withTimezone: true }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('email_send_logs_user_idx').on(t.userId), index('email_send_logs_tenant_idx').on(t.tenantId), 
  index('email_send_logs_created_at_idx').on(t.createdAt),
  index('email_send_logs_status_idx').on(t.status),
]);

export type EmailSendLogRow = typeof emailSendLogs.$inferSelect;

export type NewEmailSendLog = typeof emailSendLogs.$inferInsert;

// ── 短信服务商配置 ──────────────────────────────────────────────────────────
export const smsConfigs = pgTable('sms_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  provider: smsProviderEnum().notNull(),
  accessKeyId: varchar({ length: 256 }).notNull().default(''),
  accessKeySecret: varchar({ length: 512 }).notNull().default(''),
  region: varchar({ length: 64 }),
  signName: varchar({ length: 64 }).notNull().default(''),
  isDefault: boolean().notNull().default(false),
  status: statusEnum().default('enabled').notNull(),
  remark: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('sms_configs_tenant_idx').on(t.tenantId)]);

export type SmsConfigRow = typeof smsConfigs.$inferSelect;

export type NewSmsConfig = typeof smsConfigs.$inferInsert;

// ── 短信模板 ────────────────────────────────────────────────────────────────
export const smsTemplates = pgTable('sms_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 100 }).notNull().unique(),
  templateCode: varchar({ length: 100 }).notNull().default(''),
  signName: varchar({ length: 64 }),
  content: text().notNull(),
  variables: text(),
  provider: smsProviderEnum().notNull(),
  status: statusEnum().default('enabled').notNull(),
  remark: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('sms_templates_tenant_idx').on(t.tenantId)]);

export type SmsTemplateRow = typeof smsTemplates.$inferSelect;

export type NewSmsTemplate = typeof smsTemplates.$inferInsert;

// ── 短信发送记录 ────────────────────────────────────────────────────────────
export const smsSendLogs = pgTable('sms_send_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  configId: integer().references(() => smsConfigs.id, { onDelete: 'set null' }),
  templateId: integer().references(() => smsTemplates.id, { onDelete: 'set null' }),
  provider: smsProviderEnum().notNull(),
  phone: varchar({ length: 32 }).notNull(),
  content: text().notNull(),
  status: sendStatusEnum().default('pending').notNull(),
  errorMsg: text(),
  bizId: varchar({ length: 128 }),
  deliveryStatus: varchar({ length: 32 }),
  deliveredAt: timestamp({ withTimezone: true }),
  source: sendSourceEnum().default('manual').notNull(),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  ip: varchar({ length: 64 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  sentAt: timestamp({ withTimezone: true }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('sms_send_logs_user_idx').on(t.userId), index('sms_send_logs_tenant_idx').on(t.tenantId), 
  index('sms_send_logs_created_at_idx').on(t.createdAt),
  index('sms_send_logs_status_idx').on(t.status),
]);

export type SmsSendLogRow = typeof smsSendLogs.$inferSelect;

export type NewSmsSendLog = typeof smsSendLogs.$inferInsert;

// ── App 推送（聚合供应商;厂商通道凭证配置在供应商后台,服务端零感知）─────────
// pushProviderEnum 定义在 common.ts（messaging 与 app-releases 共用,避免模块环）

/** 推送凭证一对一挂应用:供应商侧凭证本就按 App 发放,unique(appId) 是客观模型 */
export const pushConfigs = pgTable('push_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  appId: integer().notNull().references(() => clientApps.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  provider: pushProviderEnum().notNull().default('jpush'),
  appKey: varchar({ length: 128 }).notNull().default(''),
  masterSecret: varchar({ length: 256 }).notNull().default(''),
  /** iOS APNs 环境:true=生产 false=开发（极光 options.apns_production） */
  apnsProduction: boolean().notNull().default(false),
  status: statusEnum().default('enabled').notNull(),
  remark: text(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('push_configs_app_unique').on(t.appId)]);

export type PushConfigRow = typeof pushConfigs.$inferSelect;

export type NewPushConfig = typeof pushConfigs.$inferInsert;

// 推送发送记录（追加型日志）
export const pushSendLogs = pgTable('push_send_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  configId: integer().references(() => pushConfigs.id, { onDelete: 'set null' }),
  /** 所属应用（多应用凭证路由下,一次派发可能按应用拆成多行） */
  appId: integer().references(() => clientApps.id, { onDelete: 'set null' }),
  provider: pushProviderEnum().notNull(),
  /** 收件人（test 直发 registrationId 时为空） */
  subjectType: varchar({ length: 16 }),
  subjectId: integer(),
  /** 本次投递的设备数（多设备聚合一次调用） */
  deviceCount: integer().notNull().default(0),
  title: varchar({ length: 200 }).notNull(),
  content: text().notNull(),
  /** 点击跳转深链（映射自通知事件的 link） */
  link: varchar({ length: 500 }),
  /** 通知事件 key（notify() 派发时记录;测试发送为空） */
  eventKey: varchar({ length: 128 }),
  status: sendStatusEnum().default('pending').notNull(),
  providerMsgId: varchar({ length: 128 }),
  /** 送达回执（供应商回调写入）:delivered=已送达,clicked=已点击 */
  deliveryStatus: varchar({ length: 32 }),
  deliveredAt: timestamp({ withTimezone: true }),
  clickedAt: timestamp({ withTimezone: true }),
  errorMsg: text(),
  source: sendSourceEnum().default('system').notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  sentAt: timestamp({ withTimezone: true }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('push_send_logs_created_at_idx').on(t.createdAt),
  index('push_send_logs_status_idx').on(t.status),
  index('push_send_logs_subject_idx').on(t.subjectType, t.subjectId),
  // 回执按供应商消息 ID 定位
  index('push_send_logs_provider_msg_id_idx').on(t.providerMsgId),
]);

export type PushSendLogRow = typeof pushSendLogs.$inferSelect;

export type NewPushSendLog = typeof pushSendLogs.$inferInsert;

// ─── 运营群发 ─────────────────────────────────────────────────────────────────
export const broadcastAudienceEnum = pgEnum('broadcast_audience', ['all_users', 'all_members', 'user_ids', 'member_ids']);
export const broadcastStatusEnum = pgEnum('broadcast_status', ['draft', 'sending', 'sent', 'failed', 'cancelled']);

/**
 * 群发活动:管理页圈定受众与渠道,发送时经任务中心分批调用 notify()
 * （hidden 事件 messaging.broadcast,dedupeKey `broadcast:{id}:batch:{n}` 幂等）。
 */
export const broadcastCampaigns = pgTable('broadcast_campaigns', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  title: varchar({ length: 200 }).notNull(),
  content: text().notNull(),
  link: varchar({ length: 500 }),
  /** 投递渠道(映射 notify 的 channelPolicy.only) */
  channels: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  audienceType: broadcastAudienceEnum().notNull(),
  /** 指定名单时的主体 ID 列表 */
  audienceIds: jsonb().$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  status: broadcastStatusEnum().notNull().default('draft'),
  /** 受众解析后的总人数(发送时快照) */
  totalRecipients: integer(),
  /** 已入队批次覆盖的人数 */
  enqueuedCount: integer().notNull().default(0),
  /** 任务中心任务 ID(发送后回填) */
  taskId: integer(),
  sentAt: timestamp({ withTimezone: true }),
  remark: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('broadcast_campaigns_status_idx').on(t.status),
  index('broadcast_campaigns_created_at_idx').on(t.createdAt),
]);

export type BroadcastCampaignRow = typeof broadcastCampaigns.$inferSelect;

export type NewBroadcastCampaign = typeof broadcastCampaigns.$inferInsert;

// ── 站内信模板 ──────────────────────────────────────────────────────────────
export const inAppTemplates = pgTable('in_app_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 100 }).notNull().unique(),
  title: varchar({ length: 200 }).notNull(),
  content: text().notNull(),
  type: inAppMessageTypeEnum().default('info').notNull(),
  variables: text(),
  status: statusEnum().default('enabled').notNull(),
  remark: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('in_app_templates_tenant_idx').on(t.tenantId)]);

export type InAppTemplateRow = typeof inAppTemplates.$inferSelect;

export type NewInAppTemplate = typeof inAppTemplates.$inferInsert;

// ── 站内信收件记录 ──────────────────────────────────────────────────────────
export const inAppMessages = pgTable('in_app_messages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  templateId: integer().references(() => inAppTemplates.id, { onDelete: 'set null' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar({ length: 200 }).notNull(),
  content: text().notNull(),
  type: inAppMessageTypeEnum().default('info').notNull(),
  isRead: boolean().notNull().default(false),
  readAt: timestamp({ withTimezone: true }),
  source: sendSourceEnum().default('system').notNull(),
  senderId: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 深链地址（站内路由，如 /workflow/pending?instanceId=1，点击消息跳转） */
  link: varchar({ length: 512 }),
  /** 系统消息幂等键；按收件人拼接后唯一 */
  dedupeKey: varchar({ length: 192 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('in_app_messages_tenant_idx').on(t.tenantId), 
  unique('in_app_messages_dedupe_key_unique').on(t.dedupeKey),
  index('in_app_messages_user_created_idx').on(t.userId, t.createdAt),
  index('in_app_messages_created_at_idx').on(t.createdAt),
]);

export type InAppMessageRow = typeof inAppMessages.$inferSelect;

export type NewInAppMessage = typeof inAppMessages.$inferInsert;

// ─── 标签管理 ─────────────────────────────────────────────────────────────────

// ─── 通知中心（Notification Center）───────────────────────────────────────────
// 事件目录本身不落库：唯一定义源是 shared/messaging/notification-events.ts。
// 这里的五张表只存「运行期可变」的部分——覆盖、偏好、待派发队列与派发留痕。

export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);

export const notificationRecipientTypeEnum = pgEnum('notification_recipient_type', NOTIFICATION_RECIPIENT_TYPES);

export const notificationDigestModeEnum = pgEnum('notification_digest_mode', NOTIFICATION_DIGEST_MODES);

export const notificationOutboxStatusEnum = pgEnum('notification_outbox_status', NOTIFICATION_OUTBOX_STATUSES);

export const notificationDecisionEnum = pgEnum('notification_decision', NOTIFICATION_DECISIONS);

/**
 * 平台 / 租户级事件覆盖（稀疏）。
 * 只存与代码默认值不同的行——全量物化会让「改一次默认值」变成一次数据订正。
 * `locked = true` 时收件人偏好对该渠道失效，用于合规必达类通知。
 */
export const notificationEventOverrides = pgTable('notification_event_overrides', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** null 表示平台级覆盖 */
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  eventKey: varchar({ length: 100 }).notNull(),
  channel: notificationChannelEnum().notNull(),
  enabled: boolean().notNull(),
  locked: boolean().notNull().default(false),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('notification_event_overrides_tenant_uq').on(t.tenantId, t.eventKey, t.channel).where(sql`${t.tenantId} is not null`),
  uniqueIndex('notification_event_overrides_global_uq').on(t.eventKey, t.channel).where(sql`${t.tenantId} is null`),
  index('notification_event_overrides_event_idx').on(t.eventKey),
]);

export type NotificationEventOverrideRow = typeof notificationEventOverrides.$inferSelect;

export type NewNotificationEventOverride = typeof notificationEventOverrides.$inferInsert;

/**
 * 收件人偏好覆盖（稀疏）。
 * 只落「与默认不同」的行：全量物化是 收件人数 × 事件数 × 渠道数，
 * 且默认值一变全部失真，等于把配置默认值这件事永久锁死。
 */
export const notificationPreferences = pgTable('notification_preferences', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  recipientType: notificationRecipientTypeEnum().notNull(),
  recipientId: integer().notNull(),
  eventKey: varchar({ length: 100 }).notNull(),
  channel: notificationChannelEnum().notNull(),
  enabled: boolean().notNull(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('notification_preferences_uq').on(t.recipientType, t.recipientId, t.eventKey, t.channel),
  index('notification_preferences_recipient_idx').on(t.recipientType, t.recipientId),
]);

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;

export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;

/** 收件人全局设置：免打扰时段、时区与摘要模式。 */
export const notificationRecipientSettings = pgTable('notification_recipient_settings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  recipientType: notificationRecipientTypeEnum().notNull(),
  recipientId: integer().notNull(),
  globalMuted: boolean().notNull().default(false),
  /** IANA 时区名；免打扰时段按收件人本地时间判定，不按服务器时区 */
  timezone: varchar({ length: 64 }).notNull().default('Asia/Shanghai'),
  /** HH:mm，与 quietEnd 同时为空表示未启用免打扰 */
  quietStart: varchar({ length: 5 }),
  quietEnd: varchar({ length: 5 }),
  digestMode: notificationDigestModeEnum().notNull().default('realtime'),
  digestHour: smallint().notNull().default(9),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('notification_recipient_settings_uq').on(t.recipientType, t.recipientId),
]);

export type NotificationRecipientSettingsRow = typeof notificationRecipientSettings.$inferSelect;

export type NewNotificationRecipientSettings = typeof notificationRecipientSettings.$inferInsert;

/**
 * 待派发事件 Outbox。
 * `notify()` 在业务事务内写这张表，提交后才真正投递：
 * 业务事务回滚时通知不会发出去，进程崩溃时通知也不会丢——
 * 直接在业务流程里同步调渠道两头都保证不了。
 */
export const notificationOutbox = pgTable('notification_outbox', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  eventKey: varchar({ length: 100 }).notNull(),
  /** 收件人快照，避免派发时业务数据已变更 */
  recipients: jsonb().$type<NotificationRecipient[]>().notNull(),
  vars: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  /** 管理员配置层的渠道策略（流程 notifyChannels、告警规则 channels） */
  channelPolicy: jsonb().$type<NotificationChannelPolicy>(),
  /** 渠道级参数（短信模板 id、Webhook 地址与请求体） */
  channelOptions: jsonb().$type<NotificationChannelOptions>(),
  /** 站内路由深链，点击通知跳转 */
  link: varchar({ length: 512 }),
  dedupeKey: varchar({ length: 192 }),
  status: notificationOutboxStatusEnum().notNull().default('pending'),
  attempts: integer().notNull().default(0),
  lastError: varchar({ length: 500 }),
  /** 认领时间戳：并发实例据此避免重复派发，超时后可被重新认领 */
  claimedAt: timestamp({ withTimezone: true }),
  /** 免打扰延后或摘要聚合的目标时间；为空表示立即可派发 */
  scheduledAt: timestamp({ withTimezone: true }),
  /**
   * 摘要分组键（`{recipientType}:{recipientId}:{窗口时间戳}`）。
   * 非空的行不走常规逐条派发，由摘要聚合任务按键合并成一封汇总邮件。
   */
  digestKey: varchar({ length: 128 }),
  /** 链路关联 ID，串起一次业务操作触发的全部异步副作用 */
  traceId: varchar({ length: 64 }),
  /** 因果父引用（`kind:refId` 或 `request`），链路时间线树形展示的触发源 */
  parentRef: varchar({ length: 32 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('notification_outbox_dedupe_uq').on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  index('notification_outbox_pending_idx').on(t.status, t.scheduledAt).where(sql`${t.status} = 'pending'`),
  index('notification_outbox_digest_idx').on(t.digestKey, t.scheduledAt).where(sql`${t.digestKey} is not null`),
  index('notification_outbox_event_idx').on(t.eventKey, t.createdAt),
  index('notification_outbox_tenant_idx').on(t.tenantId),
  // 链路追踪查看器按 trace_id 定位通知锚点
  index('notification_outbox_trace_idx').on(t.traceId),
]);

export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect;

export type NewNotificationOutbox = typeof notificationOutbox.$inferInsert;

/**
 * 「收件人 × 渠道」的派发决策与结果。
 *
 * 抑制与延后同样落一行：只记成功投递的话，「配置看起来正确却没人收到」
 * 就只能靠翻服务器日志排查，而这恰恰是通知系统最高频的故障报告。
 */
export const notificationDispatches = pgTable('notification_dispatches', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  outboxId: integer().references(() => notificationOutbox.id, { onDelete: 'set null' }),
  eventKey: varchar({ length: 100 }).notNull(),
  recipientType: notificationRecipientTypeEnum().notNull(),
  /** external 收件人没有账号，此列为空，地址落在 recipientAddress */
  recipientId: integer(),
  recipientAddress: varchar({ length: 512 }),
  channel: notificationChannelEnum().notNull(),
  decision: notificationDecisionEnum().notNull(),
  /** 归因码，取值见 shared 的 NOTIFICATION_REASON_CODES */
  reasonCode: varchar({ length: 64 }),
  reasonDetail: text(),
  /** 渠道返回的消息 id，便于与服务商侧对账 */
  providerMsgId: varchar({ length: 128 }),
  /** 幂等键：`${outboxDedupeKey}:${recipient}:${channel}` */
  dedupeKey: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('notification_dispatches_dedupe_uq').on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  index('notification_dispatches_recipient_idx').on(t.recipientType, t.recipientId, t.createdAt),
  index('notification_dispatches_event_idx').on(t.eventKey, t.createdAt),
  index('notification_dispatches_outbox_idx').on(t.outboxId),
  index('notification_dispatches_decision_idx').on(t.decision, t.createdAt),
]);

export type NotificationDispatchRow = typeof notificationDispatches.$inferSelect;

export type NewNotificationDispatch = typeof notificationDispatches.$inferInsert;
