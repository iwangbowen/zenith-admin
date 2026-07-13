import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, unique, uniqueIndex, text, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum } from './common';
import { auditColumns, departments, tenants, users } from './core';

// ═══════════════════════════════════════════════════════════════════════════
// 支付中心（Payment Center）
// ═══════════════════════════════════════════════════════════════════════════
export const paymentChannelEnum = pgEnum('payment_channel', ['wechat', 'alipay', 'unionpay']);

export const paymentMethodEnum = pgEnum('payment_method', [
  'wechat_native', 'wechat_jsapi', 'wechat_h5',
  'alipay_page', 'alipay_wap', 'alipay_app',
  'unionpay_qr',
  // 签约代扣（服务端发起，无用户交互）：微信委托代扣 / 支付宝周期扣款
  'wechat_papay', 'alipay_cycle',
]);

export const paymentOrderStatusEnum = pgEnum('payment_order_status', [
  'pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed',
]);

export const paymentRefundStatusEnum = pgEnum('payment_refund_status', [
  'pending', 'processing', 'success', 'failed',
]);

export const paymentRefundApprovalStatusEnum = pgEnum('payment_refund_approval_status', [
  'none', 'pending', 'approved', 'rejected',
]);

// ─── 支付渠道配置表（密钥字段以 encryptField 加密存储）─────────────────────────
export const paymentChannelConfigs = pgTable('payment_channel_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  channel: paymentChannelEnum('channel').notNull(),
  status: statusEnum('status').notNull().default('enabled'),
  isDefault: boolean('is_default').notNull().default(false),
  sandbox: boolean('sandbox').notNull().default(false),
  notifyUrl: varchar('notify_url', { length: 512 }),
  // 微信支付 v3
  wechatAppId: varchar('wechat_app_id', { length: 64 }),
  wechatMchId: varchar('wechat_mch_id', { length: 64 }),
  wechatApiV3KeyEncrypted: text('wechat_api_v3_key_encrypted'),
  wechatPrivateKeyEncrypted: text('wechat_private_key_encrypted'),
  wechatSerialNo: varchar('wechat_serial_no', { length: 128 }),
  wechatPlatformCert: text('wechat_platform_cert'),
  // 支付宝
  alipayAppId: varchar('alipay_app_id', { length: 64 }),
  alipayPrivateKeyEncrypted: text('alipay_private_key_encrypted'),
  alipayPublicKey: text('alipay_public_key'),
  alipaySignType: varchar('alipay_sign_type', { length: 16 }).default('RSA2'),
  alipayGateway: varchar('alipay_gateway', { length: 256 }),
  // 云闪付（银联全渠道）
  unionpayMerId: varchar('unionpay_mer_id', { length: 64 }),
  unionpayPrivateKeyEncrypted: text('unionpay_private_key_encrypted'),
  unionpayCertId: varchar('unionpay_cert_id', { length: 64 }),
  unionpayPublicKey: text('unionpay_public_key'),
  unionpayGateway: varchar('unionpay_gateway', { length: 256 }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type PaymentChannelConfigRow = typeof paymentChannelConfigs.$inferSelect;

export type NewPaymentChannelConfig = typeof paymentChannelConfigs.$inferInsert;

// ─── 支付订单表（核心交易表）──────────────────────────────────────────────────
export const paymentOrders = pgTable('payment_orders', {
  id: serial('id').primaryKey(),
  orderNo: varchar('order_no', { length: 64 }).notNull().unique(),
  outTradeNo: varchar('out_trade_no', { length: 64 }).notNull(),
  channelTradeNo: varchar('channel_trade_no', { length: 128 }),
  bizType: varchar('biz_type', { length: 64 }).notNull(),
  bizId: varchar('biz_id', { length: 128 }).notNull(),
  subject: varchar('subject', { length: 256 }).notNull(),
  body: varchar('body', { length: 512 }),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 8 }).notNull().default('CNY'),
  channel: paymentChannelEnum('channel').notNull(),
  channelConfigId: integer('channel_config_id').references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  /** 下单归属应用（App 维度，可空 = 未按应用下单） */
  appId: integer('app_id').references(() => paymentApps.id, { onDelete: 'set null' }),
  payMethod: paymentMethodEnum('pay_method').notNull(),
  status: paymentOrderStatusEnum('status').notNull().default('pending'),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  openId: varchar('open_id', { length: 128 }),
  clientIp: varchar('client_ip', { length: 64 }),
  departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
  paidAmount: integer('paid_amount'),
  feeAmount: integer('fee_amount'),
  netAmount: integer('net_amount'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  notifyData: text('notify_data'),
  errorMessage: varchar('error_message', { length: 512 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('payment_orders_channel_out_trade_no_uq').on(t.channel, t.outTradeNo),
  // 业务幂等：同一业务单（bizType+bizId）最多存在一笔进行中订单（pending/paying），
  // 并发下单时唯一冲突由 createPayment 捕获后复用已有活跃单
  uniqueIndex('payment_orders_active_biz_uq').on(t.bizType, t.bizId).where(sql`${t.status} in ('pending', 'paying')`),
  index('payment_orders_biz_idx').on(t.bizType, t.bizId),
  index('payment_orders_status_idx').on(t.status),
  index('payment_orders_expired_idx').on(t.expiredAt),
]);

export type PaymentOrderRow = typeof paymentOrders.$inferSelect;

export type NewPaymentOrder = typeof paymentOrders.$inferInsert;

// ─── 支付退款表 ───────────────────────────────────────────────────────────────
export const paymentRefunds = pgTable('payment_refunds', {
  id: serial('id').primaryKey(),
  refundNo: varchar('refund_no', { length: 64 }).notNull().unique(),
  outRefundNo: varchar('out_refund_no', { length: 64 }).notNull(),
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  orderId: integer('order_id').references(() => paymentOrders.id, { onDelete: 'cascade' }),
  channelRefundNo: varchar('channel_refund_no', { length: 128 }),
  channel: paymentChannelEnum('channel').notNull(),
  refundAmount: integer('refund_amount').notNull(),
  totalAmount: integer('total_amount').notNull(),
  reason: varchar('reason', { length: 256 }),
  status: paymentRefundStatusEnum('status').notNull().default('pending'),
  approvalStatus: paymentRefundApprovalStatusEnum('approval_status').notNull().default('none'),
  appliedById: integer('applied_by_id').references(() => users.id, { onDelete: 'set null' }),
  approverId: integer('approver_id').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvalRemark: varchar('approval_remark', { length: 256 }),
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  notifyData: text('notify_data'),
  errorMessage: varchar('error_message', { length: 512 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('payment_refunds_order_no_idx').on(t.orderNo),
  index('payment_refunds_status_idx').on(t.status),
]);

export type PaymentRefundRow = typeof paymentRefunds.$inferSelect;

export type NewPaymentRefund = typeof paymentRefunds.$inferInsert;

// ─── 支付回调日志表（追加型，不含审计列）──────────────────────────────────────
export const paymentNotifyLogs = pgTable('payment_notify_logs', {
  id: serial('id').primaryKey(),
  channel: paymentChannelEnum('channel').notNull(),
  scene: varchar('scene', { length: 16 }).notNull().default('payment'),
  orderNo: varchar('order_no', { length: 64 }),
  rawBody: text('raw_body'),
  headers: text('headers'),
  signatureValid: boolean('signature_valid').notNull().default(false),
  result: varchar('result', { length: 32 }),
  message: varchar('message', { length: 512 }),
  ip: varchar('ip', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('payment_notify_logs_order_no_idx').on(t.orderNo),
]);

export type PaymentNotifyLogRow = typeof paymentNotifyLogs.$inferSelect;

export type NewPaymentNotifyLog = typeof paymentNotifyLogs.$inferInsert;

// ─── 支付事件 Outbox 表（保证支付/退款成功事件可靠投递，进程崩溃后由 cron 补投）─────
export const paymentEventStatusEnum = pgEnum('payment_event_status', ['pending', 'done', 'failed']);

export const paymentEvents = pgTable('payment_events', {
  id: serial('id').primaryKey(),
  type: varchar('type', { length: 32 }).notNull(),
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  payload: text('payload').notNull(),
  status: paymentEventStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: varchar('last_error', { length: 512 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (t) => [index('payment_events_status_idx').on(t.status)]);

export type PaymentEventRow = typeof paymentEvents.$inferSelect;

export type NewPaymentEvent = typeof paymentEvents.$inferInsert;

// ─── 对账中心 ─────────────────────────────────────────────────────────────────
export const paymentReconStatusEnum = pgEnum('payment_recon_status', ['pending', 'comparing', 'done', 'failed']);

export const paymentReconResultEnum = pgEnum('payment_recon_result', ['matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff']);

export const paymentReconHandleStatusEnum = pgEnum('payment_recon_handle_status', ['pending', 'adjusted', 'suspended', 'ignored']);

export const paymentReconBatches = pgTable('payment_recon_batches', {
  id: serial('id').primaryKey(),
  batchNo: varchar('batch_no', { length: 64 }).notNull().unique(),
  channel: paymentChannelEnum('channel').notNull(),
  billDate: varchar('bill_date', { length: 10 }).notNull(),
  status: paymentReconStatusEnum('status').notNull().default('pending'),
  localCount: integer('local_count').notNull().default(0),
  localAmount: integer('local_amount').notNull().default(0),
  channelCount: integer('channel_count').notNull().default(0),
  channelAmount: integer('channel_amount').notNull().default(0),
  matchedCount: integer('matched_count').notNull().default(0),
  diffCount: integer('diff_count').notNull().default(0),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_recon_batches_date_idx').on(t.billDate)]);

export type PaymentReconBatchRow = typeof paymentReconBatches.$inferSelect;

export type NewPaymentReconBatch = typeof paymentReconBatches.$inferInsert;

export const paymentReconItems = pgTable('payment_recon_items', {
  id: serial('id').primaryKey(),
  batchId: integer('batch_id').notNull().references(() => paymentReconBatches.id, { onDelete: 'cascade' }),
  orderNo: varchar('order_no', { length: 64 }),
  channelTradeNo: varchar('channel_trade_no', { length: 128 }),
  localAmount: integer('local_amount'),
  channelAmount: integer('channel_amount'),
  localStatus: varchar('local_status', { length: 32 }),
  channelStatus: varchar('channel_status', { length: 32 }),
  result: paymentReconResultEnum('result').notNull(),
  /** 差异处理状态：NULL=无需处理（比对一致）；差异项默认 pending，人工处理后流转为 adjusted/suspended/ignored */
  handleStatus: paymentReconHandleStatusEnum('handle_status'),
  handleRemark: varchar('handle_remark', { length: 256 }),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  handledById: integer('handled_by_id').references(() => users.id, { onDelete: 'set null' }),
  remark: varchar('remark', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('payment_recon_items_batch_idx').on(t.batchId)]);

export type PaymentReconItemRow = typeof paymentReconItems.$inferSelect;

export type NewPaymentReconItem = typeof paymentReconItems.$inferInsert;

// ─── 业务方 Webhook ───────────────────────────────────────────────────────────
export const paymentWebhookDeliveryStatusEnum = pgEnum('payment_webhook_delivery_status', ['pending', 'success', 'failed']);

export const paymentWebhookEndpoints = pgTable('payment_webhook_endpoints', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  url: varchar('url', { length: 512 }).notNull(),
  secretEncrypted: text('secret_encrypted'),
  bizType: varchar('biz_type', { length: 64 }),
  events: jsonb('events').$type<string[]>().default([]).notNull(),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type PaymentWebhookEndpointRow = typeof paymentWebhookEndpoints.$inferSelect;

export type NewPaymentWebhookEndpoint = typeof paymentWebhookEndpoints.$inferInsert;

export const paymentWebhookDeliveries = pgTable('payment_webhook_deliveries', {
  id: serial('id').primaryKey(),
  endpointId: integer('endpoint_id').notNull().references(() => paymentWebhookEndpoints.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  orderNo: varchar('order_no', { length: 64 }),
  payload: text('payload').notNull(),
  status: paymentWebhookDeliveryStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  httpStatus: integer('http_status'),
  responseBody: varchar('response_body', { length: 1024 }),
  lastError: varchar('last_error', { length: 512 }),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_webhook_deliveries_endpoint_idx').on(t.endpointId), index('payment_webhook_deliveries_status_idx').on(t.status)]);

export type PaymentWebhookDeliveryRow = typeof paymentWebhookDeliveries.$inferSelect;

export type NewPaymentWebhookDelivery = typeof paymentWebhookDeliveries.$inferInsert;

// ─── 资金流水台账 ─────────────────────────────────────────────────────────────
export const paymentLedgerDirectionEnum = pgEnum('payment_ledger_direction', ['in', 'out']);

export const paymentLedgerTypeEnum = pgEnum('payment_ledger_type', ['payment', 'refund', 'fee', 'settlement', 'adjust', 'transfer']);

export const paymentLedgerEntries = pgTable('payment_ledger_entries', {
  id: serial('id').primaryKey(),
  entryNo: varchar('entry_no', { length: 64 }).notNull().unique(),
  direction: paymentLedgerDirectionEnum('direction').notNull(),
  type: paymentLedgerTypeEnum('type').notNull(),
  amount: integer('amount').notNull(),
  orderNo: varchar('order_no', { length: 64 }),
  refundNo: varchar('refund_no', { length: 64 }),
  channel: paymentChannelEnum('channel'),
  bizType: varchar('biz_type', { length: 64 }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('payment_ledger_order_idx').on(t.orderNo),
  index('payment_ledger_type_idx').on(t.type),
  // 记账幂等（DB 层兜底）：同一订单的收款/手续费各至多一条；同一退款单至多一条退款流水
  uniqueIndex('payment_ledger_order_type_uq').on(t.orderNo, t.type).where(sql`${t.orderNo} is not null and ${t.type} in ('payment', 'fee')`),
  uniqueIndex('payment_ledger_refund_uq').on(t.refundNo).where(sql`${t.refundNo} is not null and ${t.type} = 'refund'`),
]);

export type PaymentLedgerEntryRow = typeof paymentLedgerEntries.$inferSelect;

export type NewPaymentLedgerEntry = typeof paymentLedgerEntries.$inferInsert;

// ─── 手续费/费率规则 ─────────────────────────────────────────────────────────
export const paymentFeeRules = pgTable('payment_fee_rules', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  channel: paymentChannelEnum('channel').notNull(),
  payMethod: paymentMethodEnum('pay_method'),
  rateBps: integer('rate_bps').notNull().default(0),
  fixedFee: integer('fixed_fee').notNull().default(0),
  minFee: integer('min_fee'),
  maxFee: integer('max_fee'),
  status: statusEnum('status').notNull().default('enabled'),
  priority: integer('priority').notNull().default(0),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_fee_rules_channel_idx').on(t.channel)]);

export type PaymentFeeRuleRow = typeof paymentFeeRules.$inferSelect;

export type NewPaymentFeeRule = typeof paymentFeeRules.$inferInsert;

// ─── 结算批次 ─────────────────────────────────────────────────────────────────
export const paymentSettlementStatusEnum = pgEnum('payment_settlement_status', ['pending', 'settling', 'settled', 'failed']);

export const paymentSettlementBatches = pgTable('payment_settlement_batches', {
  id: serial('id').primaryKey(),
  batchNo: varchar('batch_no', { length: 64 }).notNull().unique(),
  channel: paymentChannelEnum('channel').notNull(),
  periodStart: varchar('period_start', { length: 10 }).notNull(),
  periodEnd: varchar('period_end', { length: 10 }).notNull(),
  status: paymentSettlementStatusEnum('status').notNull().default('pending'),
  orderCount: integer('order_count').notNull().default(0),
  grossAmount: integer('gross_amount').notNull().default(0),
  feeAmount: integer('fee_amount').notNull().default(0),
  refundAmount: integer('refund_amount').notNull().default(0),
  netAmount: integer('net_amount').notNull().default(0),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('payment_settlement_batches_status_idx').on(t.status),
  // 结算幂等：同租户+渠道+账期至多生成一个批次（tenantId 为 NULL 时按全局口径去重）
  uniqueIndex('payment_settlement_period_uq').on(t.channel, t.periodStart, t.periodEnd, t.tenantId).where(sql`${t.tenantId} is not null`),
  uniqueIndex('payment_settlement_period_global_uq').on(t.channel, t.periodStart, t.periodEnd).where(sql`${t.tenantId} is null`),
]);

export type PaymentSettlementBatchRow = typeof paymentSettlementBatches.$inferSelect;

export type NewPaymentSettlementBatch = typeof paymentSettlementBatches.$inferInsert;

// ─── 分账接收方 + 分账单 ─────────────────────────────────────────────────────
export const paymentSharingReceiverTypeEnum = pgEnum('payment_sharing_receiver_type', ['merchant', 'personal']);

export const paymentSharingOrderStatusEnum = pgEnum('payment_sharing_order_status', ['pending', 'processing', 'success', 'failed']);

export const paymentSharingReceivers = pgTable('payment_sharing_receivers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  receiverType: paymentSharingReceiverTypeEnum('receiver_type').notNull().default('merchant'),
  account: varchar('account', { length: 128 }).notNull(),
  ratioBps: integer('ratio_bps'),
  /** 自动分账：支付成功后按 ratioBps 自动向该接收方发起分账 */
  autoShare: boolean('auto_share').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type PaymentSharingReceiverRow = typeof paymentSharingReceivers.$inferSelect;

export type NewPaymentSharingReceiver = typeof paymentSharingReceivers.$inferInsert;

export const paymentSharingOrders = pgTable('payment_sharing_orders', {
  id: serial('id').primaryKey(),
  sharingNo: varchar('sharing_no', { length: 64 }).notNull().unique(),
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  receiverId: integer('receiver_id').notNull().references(() => paymentSharingReceivers.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  status: paymentSharingOrderStatusEnum('status').notNull().default('pending'),
  channelSharingNo: varchar('channel_sharing_no', { length: 128 }),
  /** 渠道分账已尝试次数（失败重试用，达上限后不再自动重试） */
  attempts: integer('attempts').notNull().default(0),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_sharing_orders_order_no_idx').on(t.orderNo), index('payment_sharing_orders_receiver_idx').on(t.receiverId)]);

export type PaymentSharingOrderRow = typeof paymentSharingOrders.$inferSelect;

export type NewPaymentSharingOrder = typeof paymentSharingOrders.$inferInsert;

// ─── 支付链接/收款码 ─────────────────────────────────────────────────────────
export const paymentLinkStatusEnum = pgEnum('payment_link_status', ['active', 'disabled', 'expired']);

export const paymentLinks = pgTable('payment_links', {
  id: serial('id').primaryKey(),
  linkNo: varchar('link_no', { length: 64 }).notNull().unique(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  subject: varchar('subject', { length: 256 }).notNull(),
  amount: integer('amount'),
  payMethod: paymentMethodEnum('pay_method'),
  bizType: varchar('biz_type', { length: 64 }).notNull(),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  status: paymentLinkStatusEnum('status').notNull().default('active'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type PaymentLinkRow = typeof paymentLinks.$inferSelect;

export type NewPaymentLink = typeof paymentLinks.$inferInsert;

// ─── 风控限额规则 ─────────────────────────────────────────────────────────────
export const paymentRiskScopeEnum = pgEnum('payment_risk_scope', ['global', 'channel', 'bizType']);

export const paymentRiskRules = pgTable('payment_risk_rules', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  scope: paymentRiskScopeEnum('scope').notNull().default('global'),
  channel: paymentChannelEnum('channel'),
  bizType: varchar('biz_type', { length: 64 }),
  singleLimit: integer('single_limit'),
  dailyLimit: integer('daily_limit'),
  dailyCountLimit: integer('daily_count_limit'),
  blocklist: jsonb('blocklist').$type<string[]>().default([]).notNull(),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('payment_risk_rules_scope_idx').on(t.scope)]);

export type PaymentRiskRuleRow = typeof paymentRiskRules.$inferSelect;

export type NewPaymentRiskRule = typeof paymentRiskRules.$inferInsert;

// ─── 转账/代付单 ─────────────────────────────────────────────────────────────
export const paymentTransferStatusEnum = pgEnum('payment_transfer_status', ['pending', 'processing', 'success', 'failed']);

export const paymentTransfers = pgTable('payment_transfers', {
  id: serial('id').primaryKey(),
  transferNo: varchar('transfer_no', { length: 64 }).notNull().unique(),
  /** 商户转账单号（渠道幂等键，与 transferNo 相同值单独存列便于对账） */
  outTransferNo: varchar('out_transfer_no', { length: 64 }).notNull(),
  channel: paymentChannelEnum('channel').notNull(),
  channelConfigId: integer('channel_config_id').references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  /** 收款账号（微信 openid / 支付宝登录账号） */
  receiverAccount: varchar('receiver_account', { length: 128 }).notNull(),
  receiverName: varchar('receiver_name', { length: 64 }),
  amount: integer('amount').notNull(),
  remark: varchar('remark', { length: 256 }),
  status: paymentTransferStatusEnum('status').notNull().default('pending'),
  channelTransferNo: varchar('channel_transfer_no', { length: 128 }),
  failReason: varchar('fail_reason', { length: 512 }),
  /** 渠道调用已尝试次数（仅渠道未受理的失败单可人工重试） */
  attempts: integer('attempts').notNull().default(0),
  bizType: varchar('biz_type', { length: 64 }),
  bizId: varchar('biz_id', { length: 128 }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('payment_transfers_channel_out_no_uq').on(t.channel, t.outTransferNo),
  index('payment_transfers_status_idx').on(t.status),
  index('payment_transfers_biz_idx').on(t.bizType, t.bizId),
]);

export type PaymentTransferRow = typeof paymentTransfers.$inferSelect;

export type NewPaymentTransfer = typeof paymentTransfers.$inferInsert;

// ─── 财务报表日切快照（预聚合，降大表实时聚合压力）───────────────────────────
export const paymentReportDaily = pgTable('payment_report_daily', {
  id: serial('id').primaryKey(),
  statDate: varchar('stat_date', { length: 10 }).notNull(),
  /** 渠道（文本冗余存储，'' = 未知） */
  channel: varchar('channel', { length: 16 }).notNull().default(''),
  /** 业务类型（'' = 未知） */
  bizType: varchar('biz_type', { length: 64 }).notNull().default(''),
  gross: integer('gross').notNull().default(0),
  fee: integer('fee').notNull().default(0),
  refund: integer('refund').notNull().default(0),
  count: integer('count').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('payment_report_daily_date_idx').on(t.statDate)]);

export type PaymentReportDailyRow = typeof paymentReportDaily.$inferSelect;

// ─── 支付应用（App 维度：业务方按 appKey 下单，路由到该应用绑定的渠道配置）────
export const paymentApps = pgTable('payment_apps', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  /** 业务方下单标识（createPayment 入参 appKey） */
  appKey: varchar('app_key', { length: 64 }).notNull().unique(),
  status: statusEnum('status').notNull().default('enabled'),
  wechatConfigId: integer('wechat_config_id').references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  alipayConfigId: integer('alipay_config_id').references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  unionpayConfigId: integer('unionpay_config_id').references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type PaymentAppRow = typeof paymentApps.$inferSelect;

export type NewPaymentApp = typeof paymentApps.$inferInsert;

// ─── 支付方式配置 ─────────────────────────────────────────────────────────────
export const paymentMethodConfigs = pgTable('payment_method_configs', {  id: serial('id').primaryKey(),
  method: paymentMethodEnum('method').notNull().unique(),
  channel: paymentChannelEnum('channel').notNull(),
  label: varchar('label', { length: 64 }).notNull(),
  icon: varchar('icon', { length: 128 }),
  enabled: boolean('enabled').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type PaymentMethodConfigRow = typeof paymentMethodConfigs.$inferSelect;

export type NewPaymentMethodConfig = typeof paymentMethodConfigs.$inferInsert;

// ─── 扣款计划（签约代扣的周期/金额模板）──────────────────────────────────────
export const paymentDeductPeriodEnum = pgEnum('payment_deduct_period', ['daily', 'weekly', 'monthly', 'custom']);

export const paymentDeductPlans = pgTable('payment_deduct_plans', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  period: paymentDeductPeriodEnum('period').notNull().default('monthly'),
  /** period=custom 时的自定义周期天数 */
  customDays: integer('custom_days'),
  /** 每期扣款金额（分） */
  amount: integer('amount').notNull(),
  /** 单期扣款连续失败重试上限，超过后协议自动暂停 */
  maxRetries: integer('max_retries').notNull().default(3),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type PaymentDeductPlanRow = typeof paymentDeductPlans.$inferSelect;

export type NewPaymentDeductPlan = typeof paymentDeductPlans.$inferInsert;

// ─── 签约代扣协议（微信委托代扣 / 支付宝周期扣款）────────────────────────────
export const paymentContractStatusEnum = pgEnum('payment_contract_status', ['pending', 'signed', 'paused', 'terminated']);

export const paymentContracts = pgTable('payment_contracts', {
  id: serial('id').primaryKey(),
  contractNo: varchar('contract_no', { length: 64 }).notNull().unique(),
  channel: paymentChannelEnum('channel').notNull(),
  channelConfigId: integer('channel_config_id').references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  planId: integer('plan_id').notNull().references(() => paymentDeductPlans.id, { onDelete: 'restrict' }),
  /** 签约账号（微信 openid / 支付宝账号 / 会员标识） */
  signerAccount: varchar('signer_account', { length: 128 }).notNull(),
  signerName: varchar('signer_name', { length: 64 }),
  status: paymentContractStatusEnum('status').notNull().default('pending'),
  /** 渠道协议号（签约成功后回填） */
  channelContractNo: varchar('channel_contract_no', { length: 128 }),
  bizType: varchar('biz_type', { length: 64 }).notNull(),
  bizId: varchar('biz_id', { length: 128 }).notNull(),
  /** 下次扣款时间（signed 状态下由 cron 扫描执行） */
  nextDeductAt: timestamp('next_deduct_at', { withTimezone: true }),
  lastDeductAt: timestamp('last_deduct_at', { withTimezone: true }),
  /** 当前期连续扣款失败次数（成功后清零，达到计划 maxRetries 自动暂停） */
  failCount: integer('fail_count').notNull().default(0),
  /** 累计成功扣款期数 */
  totalDeductCount: integer('total_deduct_count').notNull().default(0),
  /** 最近一期扣款订单号 */
  lastOrderNo: varchar('last_order_no', { length: 64 }),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  // 同一业务单（bizType+bizId）最多一份未终止协议，防止重复签约
  uniqueIndex('payment_contracts_active_biz_uq').on(t.bizType, t.bizId).where(sql`${t.status} in ('pending', 'signed', 'paused')`),
  index('payment_contracts_status_idx').on(t.status),
  index('payment_contracts_next_deduct_idx').on(t.nextDeductAt),
  index('payment_contracts_biz_idx').on(t.bizType, t.bizId),
]);

export type PaymentContractRow = typeof paymentContracts.$inferSelect;

export type NewPaymentContract = typeof paymentContracts.$inferInsert;

// ─── 交易投诉/争议（微信支付投诉、支付宝交易投诉的本地聚合工单）──────────────
export const paymentDisputeTypeEnum = pgEnum('payment_dispute_type', ['refund_request', 'service_issue', 'fraud_report', 'other']);

export const paymentDisputeStatusEnum = pgEnum('payment_dispute_status', ['pending', 'processing', 'resolved', 'refunded']);

export const paymentDisputeReplyAuthorEnum = pgEnum('payment_dispute_reply_author', ['merchant', 'user', 'system']);

export const paymentDisputes = pgTable('payment_disputes', {
  id: serial('id').primaryKey(),
  disputeNo: varchar('dispute_no', { length: 64 }).notNull().unique(),
  /** 渠道投诉单号（微信 complaint_id / 支付宝反馈单号） */
  channelDisputeNo: varchar('channel_dispute_no', { length: 128 }),
  channel: paymentChannelEnum('channel').notNull(),
  /** 关联支付订单号（松耦合，与 payment_events 一致） */
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  /** 投诉人标识（openid / 手机号掩码） */
  complainant: varchar('complainant', { length: 128 }),
  complainantPhone: varchar('complainant_phone', { length: 32 }),
  /** 投诉类型 */
  type: paymentDisputeTypeEnum('type').notNull().default('other'),
  /** 投诉描述 */
  content: text('content').notNull(),
  /** 涉诉金额（分） */
  amount: integer('amount').notNull().default(0),
  status: paymentDisputeStatusEnum('status').notNull().default('pending'),
  /** 处理时效（超过未完结视为超时，触发预警） */
  deadline: timestamp('deadline', { withTimezone: true }),
  /** 关联退款单号（投诉退款后回填） */
  refundNo: varchar('refund_no', { length: 64 }),
  /** 完结时间（resolved / refunded） */
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('payment_disputes_status_idx').on(t.status),
  index('payment_disputes_order_no_idx').on(t.orderNo),
  index('payment_disputes_deadline_idx').on(t.deadline),
]);

export type PaymentDisputeRow = typeof paymentDisputes.$inferSelect;

export type NewPaymentDispute = typeof paymentDisputes.$inferInsert;

/** 投诉处理时间线（追加型日志：商户回复 / 用户补充 / 系统动作） */
export const paymentDisputeReplies = pgTable('payment_dispute_replies', {
  id: serial('id').primaryKey(),
  disputeId: integer('dispute_id').notNull().references(() => paymentDisputes.id, { onDelete: 'cascade' }),
  author: paymentDisputeReplyAuthorEnum('author').notNull().default('merchant'),
  content: text('content').notNull(),
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('payment_dispute_replies_dispute_idx').on(t.disputeId)]);

export type PaymentDisputeReplyRow = typeof paymentDisputeReplies.$inferSelect;

export type NewPaymentDisputeReply = typeof paymentDisputeReplies.$inferInsert;

// ─── 关系声明（Drizzle Relational Query API）──────────────────────────────────
// 声明后可使用 db.query.xxx.findMany({ with: { ... } }) 进行关联查询
