import { pgTable, varchar, timestamp, pgEnum, integer, bigint, boolean, unique, uniqueIndex, text, index, jsonb, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CreatePaymentResult } from '@zenith/shared/payment';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, departments, tenants, users } from './core';
import { oauth2Clients } from './open-platform';

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
  // 预授权转支付（冻结资金转正式交易）
  'wechat_preauth', 'alipay_preauth',
]);

export const paymentOrderStatusEnum = pgEnum('payment_order_status', [
  'pending', 'paying', 'unknown', 'success', 'closed', 'refunding', 'refunded', 'failed',
]);

export const paymentRefundStatusEnum = pgEnum('payment_refund_status', [
  'pending', 'processing', 'unknown', 'success', 'failed',
]);

export const paymentRefundApprovalStatusEnum = pgEnum('payment_refund_approval_status', [
  'none', 'pending', 'approved', 'rejected',
]);

// ─── 支付渠道配置表（密钥字段以 encryptField 加密存储）─────────────────────────
export const paymentChannelConfigs = pgTable('payment_channel_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  channel: paymentChannelEnum().notNull(),
  status: statusEnum().notNull().default('enabled'),
  isDefault: boolean().notNull().default(false),
  sandbox: boolean().notNull().default(false),
  callbackToken: varchar({ length: 64 }).notNull().unique('payment_channel_configs_callback_token_unique'),
  sandboxNotifySecretEncrypted: text().notNull(),
  notifyUrl: varchar({ length: 512 }),
  // 微信支付 v3
  wechatAppId: varchar({ length: 64 }),
  wechatMchId: varchar({ length: 64 }),
  wechatApiV3KeyEncrypted: text('wechat_api_v3_key_encrypted'),
  wechatPrivateKeyEncrypted: text(),
  wechatSerialNo: varchar({ length: 128 }),
  wechatPlatformCert: text(),
  // 支付宝
  alipayAppId: varchar({ length: 64 }),
  alipaySellerId: varchar({ length: 64 }),
  alipayPrivateKeyEncrypted: text(),
  alipayPublicKey: text(),
  alipaySignType: varchar({ length: 16 }).default('RSA2'),
  alipayGateway: varchar({ length: 256 }),
  // 云闪付（银联全渠道）
  unionpayMerId: varchar({ length: 64 }),
  unionpayPrivateKeyEncrypted: text(),
  unionpayCertId: varchar({ length: 64 }),
  unionpayPublicKey: text(),
  unionpayGateway: varchar({ length: 256 }),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('payment_channel_configs_tenant_idx').on(t.tenantId),
  uniqueIndex('payment_channel_configs_default_tenant_channel_uq')
    .on(t.tenantId, t.channel)
    .where(sql`${t.isDefault} = true and ${t.tenantId} is not null`),
  uniqueIndex('payment_channel_configs_default_global_channel_uq')
    .on(t.channel)
    .where(sql`${t.isDefault} = true and ${t.tenantId} is null`),
]);

export type PaymentChannelConfigRow = typeof paymentChannelConfigs.$inferSelect;

export type NewPaymentChannelConfig = typeof paymentChannelConfigs.$inferInsert;

// ─── 支付订单表（核心交易表）──────────────────────────────────────────────────
export const paymentOrders = pgTable('payment_orders', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  orderNo: varchar({ length: 64 }).notNull().unique('payment_orders_order_no_unique'),
  outTradeNo: varchar({ length: 64 }).notNull(),
  channelTradeNo: varchar({ length: 128 }),
  bizType: varchar({ length: 64 }).notNull(),
  bizId: varchar({ length: 128 }).notNull(),
  subject: varchar({ length: 256 }).notNull(),
  body: varchar({ length: 512 }),
  amount: integer().notNull(),
  currency: varchar({ length: 8 }).notNull().default('CNY'),
  channel: paymentChannelEnum().notNull(),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  /** 下单归属应用。支付业务事实必须有明确应用作用域。 */
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  payMethod: paymentMethodEnum().notNull(),
  status: paymentOrderStatusEnum().notNull().default('pending'),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  openId: varchar({ length: 128 }),
  clientIp: varchar({ length: 64 }),
  departmentId: integer().references(() => departments.id, { onDelete: 'set null' }),
  paidAmount: integer(),
  feeAmount: integer(),
  netAmount: integer(),
  /** 优惠前原价（分）；null = 无优惠（等于 amount） */
  originalAmount: integer(),
  /** 优惠立减金额（分） */
  discountAmount: integer(),
  /** 支付使用的会员券（member_coupons.id；跨域松耦合不建 FK，核销/释放由事件订阅者按状态原子流转） */
  memberCouponId: integer(),
  paidAt: timestamp({ withTimezone: true }),
  expiredAt: timestamp({ withTimezone: true }),
  returnUrl: varchar({ length: 512 }),
  notifyData: text(),
  errorMessage: varchar({ length: 512 }),
  idempotencyKey: varchar({ length: 128 }),
  requestHash: varchar({ length: 64 }),
  version: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_orders_user_idx').on(t.userId), index('payment_orders_tenant_idx').on(t.tenantId), 
  unique('payment_orders_config_out_trade_no_uq').on(t.channelConfigId, t.outTradeNo),
  // 业务幂等：同一业务单（bizType+bizId）最多存在一笔进行中订单（pending/paying），
  // 并发下单时唯一冲突由 createPayment 捕获后复用已有活跃单
  uniqueIndex('payment_orders_active_biz_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, sql`coalesce(${t.appId}, 0)`, t.bizType, t.bizId, t.currency)
    .where(sql`${t.status} in ('pending', 'paying', 'unknown')`),
  uniqueIndex('payment_orders_idempotency_scope_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, sql`coalesce(${t.appId}, 0)`, t.idempotencyKey)
    .where(sql`${t.idempotencyKey} is not null`),
  index('payment_orders_biz_idx').on(t.tenantId, t.appId, t.bizType, t.bizId, t.currency),
  index('payment_orders_status_idx').on(t.status),
  index('payment_orders_expired_idx').on(t.expiredAt),
]);

export type PaymentOrderRow = typeof paymentOrders.$inferSelect;

export type NewPaymentOrder = typeof paymentOrders.$inferInsert;

// ─── 支付退款表 ───────────────────────────────────────────────────────────────
export const paymentRefunds = pgTable('payment_refunds', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  refundNo: varchar({ length: 64 }).notNull().unique('payment_refunds_refund_no_unique'),
  outRefundNo: varchar({ length: 64 }).notNull(),
  orderNo: varchar({ length: 64 }).notNull(),
  orderId: integer().notNull().references(() => paymentOrders.id, { onDelete: 'restrict' }),
  channelRefundNo: varchar({ length: 128 }),
  channel: paymentChannelEnum().notNull(),
  refundAmount: integer().notNull(),
  totalAmount: integer().notNull(),
  reason: varchar({ length: 256 }),
  status: paymentRefundStatusEnum().notNull().default('pending'),
  approvalStatus: paymentRefundApprovalStatusEnum().notNull().default('none'),
  appliedById: integer().references(() => users.id, { onDelete: 'set null' }),
  approverId: integer().references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp({ withTimezone: true }),
  approvalRemark: varchar({ length: 256 }),
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  refundedAt: timestamp({ withTimezone: true }),
  notifyData: text(),
  errorMessage: varchar({ length: 512 }),
  idempotencyKey: varchar({ length: 128 }),
  requestHash: varchar({ length: 64 }),
  version: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_refunds_order_idx').on(t.orderId), index('payment_refunds_operator_idx').on(t.operatorId), index('payment_refunds_tenant_idx').on(t.tenantId), 
  index('payment_refunds_order_no_idx').on(t.orderNo),
  index('payment_refunds_status_idx').on(t.status),
  uniqueIndex('payment_refunds_idempotency_scope_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.orderId, t.idempotencyKey)
    .where(sql`${t.idempotencyKey} is not null`),
]);

export type PaymentRefundRow = typeof paymentRefunds.$inferSelect;

export type NewPaymentRefund = typeof paymentRefunds.$inferInsert;

// ─── 支付回调日志表（追加型，不含审计列）──────────────────────────────────────
export const paymentNotifyLogs = pgTable('payment_notify_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  channel: paymentChannelEnum().notNull(),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  appId: integer().references(() => paymentApps.id, { onDelete: 'set null' }),
  providerEventId: varchar({ length: 128 }),
  scene: varchar({ length: 16 }).notNull().default('payment'),
  orderNo: varchar({ length: 64 }),
  rawBody: text(),
  headers: text(),
  signatureValid: boolean().notNull().default(false),
  merchantId: varchar({ length: 128 }),
  providerAppId: varchar({ length: 128 }),
  paidAmount: integer(),
  currency: varchar({ length: 8 }),
  result: varchar({ length: 32 }),
  message: varchar({ length: 512 }),
  ip: varchar({ length: 64 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('payment_notify_logs_tenant_idx').on(t.tenantId),
  index('payment_notify_logs_config_idx').on(t.channelConfigId),
  uniqueIndex('payment_notify_logs_provider_event_uq').on(t.channelConfigId, t.providerEventId).where(sql`${t.providerEventId} is not null`),
  index('payment_notify_logs_order_no_idx').on(t.orderNo),
]);

export type PaymentNotifyLogRow = typeof paymentNotifyLogs.$inferSelect;

export type NewPaymentNotifyLog = typeof paymentNotifyLogs.$inferInsert;

// ─── 支付事件 Outbox 表（保证支付/退款成功事件可靠投递，进程崩溃后由 cron 补投）─────
export const paymentEventStatusEnum = pgEnum('payment_event_status', ['pending', 'done', 'failed']);

export const paymentEvents = pgTable('payment_events', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  type: varchar({ length: 32 }).notNull(),
  orderNo: varchar({ length: 64 }).notNull(),
  payload: text().notNull(),
  status: paymentEventStatusEnum().notNull().default('pending'),
  attempts: integer().notNull().default(0),
  lastError: varchar({ length: 512 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
  processedAt: timestamp({ withTimezone: true }),
}, (t) => [index('payment_events_tenant_idx').on(t.tenantId), index('payment_events_status_idx').on(t.status)]);

export type PaymentEventRow = typeof paymentEvents.$inferSelect;

export type NewPaymentEvent = typeof paymentEvents.$inferInsert;

// ─── 对账中心 ─────────────────────────────────────────────────────────────────
export const paymentReconStatusEnum = pgEnum('payment_recon_status', ['pending', 'comparing', 'done', 'failed']);

export const paymentReconResultEnum = pgEnum('payment_recon_result', ['matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff']);

export const paymentReconHandleStatusEnum = pgEnum('payment_recon_handle_status', ['pending', 'adjusted', 'suspended', 'ignored']);

export const paymentReconSourceEnum = pgEnum('payment_recon_source', ['manual_upload', 'sandbox_generated', 'provider_download']);

export const paymentReconBatches = pgTable('payment_recon_batches', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  batchNo: varchar({ length: 64 }).notNull().unique('payment_recon_batches_batch_no_unique'),
  channel: paymentChannelEnum().notNull(),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull().default('CNY'),
  billDate: varchar({ length: 10 }).notNull(),
  source: paymentReconSourceEnum().notNull().default('manual_upload'),
  status: paymentReconStatusEnum().notNull().default('pending'),
  localCount: integer().notNull().default(0),
  localAmount: integer().notNull().default(0),
  channelCount: integer().notNull().default(0),
  channelAmount: integer().notNull().default(0),
  matchedCount: integer().notNull().default(0),
  diffCount: integer().notNull().default(0),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('payment_recon_batches_tenant_idx').on(t.tenantId),
  index('payment_recon_batches_date_idx').on(t.billDate),
  index('payment_recon_batches_app_idx').on(t.appId),
  uniqueIndex('payment_recon_scope_date_uq').on(sql`coalesce(${t.tenantId}, 0)`, t.appId, t.channelConfigId, t.currency, t.billDate),
]);

export type PaymentReconBatchRow = typeof paymentReconBatches.$inferSelect;

export type NewPaymentReconBatch = typeof paymentReconBatches.$inferInsert;

export const paymentReconItems = pgTable('payment_recon_items', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  batchId: integer().notNull().references(() => paymentReconBatches.id, { onDelete: 'cascade' }),
  orderNo: varchar({ length: 64 }),
  channelTradeNo: varchar({ length: 128 }),
  localAmount: integer(),
  channelAmount: integer(),
  localStatus: varchar({ length: 32 }),
  channelStatus: varchar({ length: 32 }),
  result: paymentReconResultEnum().notNull(),
  /** 差异处理状态：NULL=无需处理（比对一致）；差异项默认 pending，人工处理后流转为 adjusted/suspended/ignored */
  handleStatus: paymentReconHandleStatusEnum(),
  handleRemark: varchar({ length: 256 }),
  handledAt: timestamp({ withTimezone: true }),
  handledById: integer().references(() => users.id, { onDelete: 'set null' }),
  remark: varchar({ length: 256 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('payment_recon_items_batch_idx').on(t.batchId)]);

export type PaymentReconItemRow = typeof paymentReconItems.$inferSelect;

export type NewPaymentReconItem = typeof paymentReconItems.$inferInsert;

// ─── 手续费/费率规则 ─────────────────────────────────────────────────────────
export const paymentFeeRules = pgTable('payment_fee_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  channel: paymentChannelEnum().notNull(),
  payMethod: paymentMethodEnum(),
  rateBps: integer().notNull().default(0),
  fixedFee: integer().notNull().default(0),
  minFee: integer(),
  maxFee: integer(),
  status: statusEnum().notNull().default('enabled'),
  priority: integer().notNull().default(0),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_fee_rules_tenant_idx').on(t.tenantId), index('payment_fee_rules_channel_idx').on(t.channel)]);

export type PaymentFeeRuleRow = typeof paymentFeeRules.$inferSelect;

export type NewPaymentFeeRule = typeof paymentFeeRules.$inferInsert;

// ─── 结算批次 ─────────────────────────────────────────────────────────────────
export const paymentSettlementStatusEnum = pgEnum('payment_settlement_status', ['pending', 'settling', 'settled', 'failed']);

export const paymentSettlementBatches = pgTable('payment_settlement_batches', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  batchNo: varchar({ length: 64 }).notNull().unique('payment_settlement_batches_batch_no_unique'),
  channel: paymentChannelEnum().notNull(),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull().default('CNY'),
  periodStart: varchar({ length: 10 }).notNull(),
  periodEnd: varchar({ length: 10 }).notNull(),
  status: paymentSettlementStatusEnum().notNull().default('pending'),
  orderCount: integer().notNull().default(0),
  grossAmount: integer().notNull().default(0),
  feeAmount: integer().notNull().default(0),
  refundAmount: integer().notNull().default(0),
  /** 账期内分账支出合计（分），净额已扣除 */
  sharingAmount: integer().notNull().default(0),
  netAmount: integer().notNull().default(0),
  settledAt: timestamp({ withTimezone: true }),
  failureReason: varchar({ length: 512 }),
  payoutReference: varchar({ length: 128 }),
  version: integer().notNull().default(0),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_settlement_batches_tenant_idx').on(t.tenantId), 
  index('payment_settlement_batches_app_idx').on(t.appId),
  index('payment_settlement_batches_status_idx').on(t.status),
  // 同一账期可存在多个增量批次；逐笔认领的唯一边界由
  // payment_settlement_items.journal_line_id 约束，避免新到账资金被旧批次挡住。
]);

export type PaymentSettlementBatchRow = typeof paymentSettlementBatches.$inferSelect;

export type NewPaymentSettlementBatch = typeof paymentSettlementBatches.$inferInsert;

// ─── 分账接收方 + 分账单 ─────────────────────────────────────────────────────
export const paymentSharingReceiverTypeEnum = pgEnum('payment_sharing_receiver_type', ['merchant', 'personal']);

export const paymentSharingOrderStatusEnum = pgEnum('payment_sharing_order_status', ['pending', 'processing', 'success', 'failed', 'reversed']);

export const paymentSharingReversalStatusEnum = pgEnum('payment_sharing_reversal_status', ['processing', 'unknown', 'success', 'failed']);

export const paymentSharingReceivers = pgTable('payment_sharing_receivers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  receiverType: paymentSharingReceiverTypeEnum().notNull().default('merchant'),
  account: varchar({ length: 128 }).notNull(),
  ratioBps: integer(),
  /** 自动分账：支付成功后按 ratioBps 自动向该接收方发起分账 */
  autoShare: boolean().notNull().default(false),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_sharing_receivers_tenant_idx').on(t.tenantId)]);

export type PaymentSharingReceiverRow = typeof paymentSharingReceivers.$inferSelect;

export type NewPaymentSharingReceiver = typeof paymentSharingReceivers.$inferInsert;

export const paymentSharingOrders = pgTable('payment_sharing_orders', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sharingNo: varchar({ length: 64 }).notNull().unique('payment_sharing_orders_sharing_no_unique'),
  orderNo: varchar({ length: 64 }).notNull(),
  receiverId: integer().notNull().references(() => paymentSharingReceivers.id, { onDelete: 'restrict' }),
  amount: integer().notNull(),
  status: paymentSharingOrderStatusEnum().notNull().default('pending'),
  channelSharingNo: varchar({ length: 128 }),
  /** 渠道分账已尝试次数（失败重试用，达上限后不再自动重试） */
  attempts: integer().notNull().default(0),
  version: integer().notNull().default(0),
  finishedAt: timestamp({ withTimezone: true }),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_sharing_orders_tenant_idx').on(t.tenantId), index('payment_sharing_orders_order_no_idx').on(t.orderNo), index('payment_sharing_orders_receiver_idx').on(t.receiverId)]);

export type PaymentSharingOrderRow = typeof paymentSharingOrders.$inferSelect;

export type NewPaymentSharingOrder = typeof paymentSharingOrders.$inferInsert;

/** 分账冲正：一笔成功分账最多一条冲正操作；unknown 只允许查单收敛，禁止重新发起。 */
export const paymentSharingReversals = pgTable('payment_sharing_reversals', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  reversalNo: varchar({ length: 64 }).notNull().unique('payment_sharing_reversals_reversal_no_unique'),
  sharingOrderId: integer().notNull().references(() => paymentSharingOrders.id, { onDelete: 'restrict' }),
  amount: integer().notNull(),
  status: paymentSharingReversalStatusEnum().notNull().default('processing'),
  channelReversalNo: varchar({ length: 128 }),
  idempotencyKey: varchar({ length: 128 }).notNull(),
  requestHash: varchar({ length: 64 }).notNull(),
  reason: varchar({ length: 256 }).notNull(),
  attempts: integer().notNull().default(0),
  queryAttempts: integer().notNull().default(0),
  version: integer().notNull().default(0),
  errorMessage: varchar({ length: 512 }),
  finishedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'restrict' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('payment_sharing_reversals_sharing_order_unique').on(t.sharingOrderId),
  uniqueIndex('payment_sharing_reversals_idempotency_scope_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.sharingOrderId, t.idempotencyKey),
  index('payment_sharing_reversals_tenant_status_idx').on(t.tenantId, t.status),
]);

export type PaymentSharingReversalRow = typeof paymentSharingReversals.$inferSelect;

export type NewPaymentSharingReversal = typeof paymentSharingReversals.$inferInsert;

// ─── 支付链接/收款码 ─────────────────────────────────────────────────────────
export const paymentLinkStatusEnum = pgEnum('payment_link_status', ['active', 'disabled', 'expired']);

export const paymentLinks = pgTable('payment_links', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  linkNo: varchar({ length: 64 }).notNull().unique('payment_links_link_no_unique'),
  token: varchar({ length: 64 }).notNull().unique(),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  subject: varchar({ length: 256 }).notNull(),
  amount: integer(),
  payMethod: paymentMethodEnum(),
  bizType: varchar({ length: 64 }).notNull(),
  maxUses: integer(),
  usedCount: integer().notNull().default(0),
  reservedCount: integer().notNull().default(0),
  expiredAt: timestamp({ withTimezone: true }),
  status: paymentLinkStatusEnum().notNull().default('active'),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_links_tenant_idx').on(t.tenantId), index('payment_links_app_idx').on(t.appId)]);

export type PaymentLinkRow = typeof paymentLinks.$inferSelect;

export type NewPaymentLink = typeof paymentLinks.$inferInsert;

/** 支付链接成功核销记录：仅 payment.succeeded 后追加，orderNo 唯一保证重复事件不重复计数。 */
export const paymentLinkRedemptions = pgTable('payment_link_redemptions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  linkId: integer().notNull().references(() => paymentLinks.id, { onDelete: 'cascade' }),
  orderNo: varchar({ length: 64 }).notNull().unique('payment_link_redemptions_order_no_unique'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  redeemedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('payment_link_redemptions_link_idx').on(t.linkId),
  index('payment_link_redemptions_tenant_idx').on(t.tenantId),
]);

export type PaymentLinkRedemptionRow = typeof paymentLinkRedemptions.$inferSelect;

export type NewPaymentLinkRedemption = typeof paymentLinkRedemptions.$inferInsert;

export const paymentCashierSessionStatusEnum = pgEnum('payment_cashier_session_status', [
  'ready',
  'creating',
  'awaiting',
  'processing',
  'unknown',
  'succeeded',
  'failed',
  'expired',
]);

export const paymentCashierUseSlotStatusEnum = pgEnum('payment_cashier_use_slot_status', [
  'none',
  'reserved',
  'consumed',
  'released',
]);

/** 公开收银台会话：保存第三方跳转前后的订单与支付参数，token 不可枚举。 */
export const paymentCashierSessions = pgTable('payment_cashier_sessions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sessionToken: varchar({ length: 64 }).notNull().unique('payment_cashier_sessions_session_token_unique'),
  linkId: integer().notNull().references(() => paymentLinks.id, { onDelete: 'restrict' }),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  orderNo: varchar({ length: 64 }),
  payMethod: paymentMethodEnum().notNull(),
  amount: integer().notNull(),
  status: paymentCashierSessionStatusEnum().notNull().default('ready'),
  useSlotStatus: paymentCashierUseSlotStatusEnum().notNull().default('none'),
  payParams: jsonb().$type<CreatePaymentResult>(),
  returnUrl: varchar({ length: 512 }).notNull(),
  errorMessage: varchar({ length: 512 }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  version: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('payment_cashier_sessions_order_no_unique').on(t.orderNo).where(sql`${t.orderNo} is not null`),
  index('payment_cashier_sessions_link_idx').on(t.linkId),
  index('payment_cashier_sessions_link_slot_idx').on(t.linkId, t.useSlotStatus, t.expiresAt),
  index('payment_cashier_sessions_status_expiry_idx').on(t.status, t.expiresAt),
  index('payment_cashier_sessions_tenant_idx').on(t.tenantId),
]);

export type PaymentCashierSessionRow = typeof paymentCashierSessions.$inferSelect;

export type NewPaymentCashierSession = typeof paymentCashierSessions.$inferInsert;

// ─── 风控限额规则 ─────────────────────────────────────────────────────────────
export const paymentRiskScopeEnum = pgEnum('payment_risk_scope', ['global', 'channel', 'bizType']);

/** 命中动作：block=直接拦截下单；review=落单挂起进入人工审核队列 */
export const paymentRiskActionEnum = pgEnum('payment_risk_action', ['block', 'review']);

export const paymentRiskRules = pgTable('payment_risk_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  scope: paymentRiskScopeEnum().notNull().default('global'),
  channel: paymentChannelEnum(),
  bizType: varchar({ length: 64 }),
  singleLimit: integer(),
  dailyLimit: integer(),
  dailyCountLimit: integer(),
  /** 引用的黑名单库 key（规则中心名单库，type=black/grey），任一名单命中任一主体标识即触发动作 */
  blockListKeys: jsonb().$type<string[]>().default([]).notNull(),
  /** 引用的白名单库 key（type=white），任一命中则跳过本规则全部检查 */
  allowListKeys: jsonb().$type<string[]>().default([]).notNull(),
  /** 命中动作（block=拦截，review=挂起人工审核） */
  action: paymentRiskActionEnum().notNull().default('block'),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_risk_rules_tenant_idx').on(t.tenantId), index('payment_risk_rules_scope_idx').on(t.scope)]);

export type PaymentRiskRuleRow = typeof paymentRiskRules.$inferSelect;

export type NewPaymentRiskRule = typeof paymentRiskRules.$inferInsert;

// ─── 风控命中留痕（追加型日志：每次拦截/送审都落一条）─────────────────────────
export const paymentRiskDimensionEnum = pgEnum('payment_risk_dimension', ['blocklist', 'single_limit', 'daily_limit', 'daily_count', 'decision']);

export const paymentRiskHits = pgTable('payment_risk_hits', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  ruleId: integer().references(() => paymentRiskRules.id, { onDelete: 'set null' }),
  /** 规则名冗余存储（规则删除后留痕仍可读） */
  ruleName: varchar({ length: 64 }).notNull(),
  action: paymentRiskActionEnum().notNull(),
  /** 命中维度 */
  dimension: paymentRiskDimensionEnum().notNull(),
  /** 命中值描述（名单值 / 金额与限额） */
  dimensionValue: varchar({ length: 256 }),
  channel: paymentChannelEnum().notNull(),
  bizType: varchar({ length: 64 }).notNull(),
  bizId: varchar({ length: 128 }).notNull(),
  /** review 挂起时关联的订单号（block 在落单前拦截，无订单） */
  orderNo: varchar({ length: 64 }),
  amount: integer().notNull(),
  openId: varchar({ length: 128 }),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  clientIp: varchar({ length: 64 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('payment_risk_hits_user_idx').on(t.userId), index('payment_risk_hits_tenant_idx').on(t.tenantId), 
  index('payment_risk_hits_created_idx').on(t.createdAt),
  index('payment_risk_hits_rule_idx').on(t.ruleId),
]);

export type PaymentRiskHitRow = typeof paymentRiskHits.$inferSelect;

export type NewPaymentRiskHit = typeof paymentRiskHits.$inferInsert;

// ─── 人工审核队列（review 动作挂起的可疑交易）─────────────────────────────────
export const paymentRiskReviewStatusEnum = pgEnum('payment_risk_review_status', ['pending', 'approved', 'rejected']);

export const paymentRiskReviews = pgTable('payment_risk_reviews', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  reviewNo: varchar({ length: 64 }).notNull().unique('payment_risk_reviews_review_no_unique'),
  hitId: integer().references(() => paymentRiskHits.id, { onDelete: 'set null' }),
  /** 被挂起的支付订单号 */
  orderNo: varchar({ length: 64 }).notNull(),
  channel: paymentChannelEnum().notNull(),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  bizType: varchar({ length: 64 }).notNull(),
  bizId: varchar({ length: 128 }).notNull(),
  amount: integer().notNull(),
  currency: varchar({ length: 8 }).notNull().default('CNY'),
  /** 触发原因（命中规则与维度描述） */
  reason: varchar({ length: 256 }).notNull(),
  status: paymentRiskReviewStatusEnum().notNull().default('pending'),
  reviewerId: integer().references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp({ withTimezone: true }),
  reviewRemark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_risk_reviews_tenant_idx').on(t.tenantId), 
  uniqueIndex('payment_risk_reviews_pending_biz_scope_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, sql`coalesce(${t.appId}, 0)`, t.bizType, t.bizId, t.currency)
    .where(sql`${t.status} = 'pending'`),
  index('payment_risk_reviews_order_no_idx').on(t.orderNo),
  index('payment_risk_reviews_status_idx').on(t.status),
  index('payment_risk_reviews_biz_idx').on(t.bizType, t.bizId),
]);

export type PaymentRiskReviewRow = typeof paymentRiskReviews.$inferSelect;

export type NewPaymentRiskReview = typeof paymentRiskReviews.$inferInsert;

// ─── 预授权（资金冻结/解冻/转支付：押金类场景）───────────────────────────────
export const paymentPreauthStatusEnum = pgEnum('payment_preauth_status', ['pending', 'unknown', 'frozen', 'captured', 'released', 'failed']);

export const paymentPreauthOperationEnum = pgEnum('payment_preauth_operation', ['freeze', 'capture', 'release']);

export const paymentPreauths = pgTable('payment_preauths', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  preauthNo: varchar({ length: 64 }).notNull().unique('payment_preauths_preauth_no_unique'),
  channel: paymentChannelEnum().notNull(),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull().default('CNY'),
  /** 渠道资金授权订单号（冻结成功后回填） */
  channelPreauthNo: varchar({ length: 128 }),
  bizType: varchar({ length: 64 }).notNull(),
  bizId: varchar({ length: 128 }).notNull(),
  subject: varchar({ length: 256 }).notNull(),
  /** 付款人账号（微信 openid / 支付宝账号） */
  payerAccount: varchar({ length: 128 }).notNull(),
  /** 冻结金额（分） */
  frozenAmount: integer().notNull(),
  /** 已转支付金额（分，剩余部分在转支付时自动解冻） */
  capturedAmount: integer(),
  /** 转支付生成的支付订单号 */
  captureOrderNo: varchar({ length: 64 }),
  status: paymentPreauthStatusEnum().notNull().default('pending'),
  unknownOperation: paymentPreauthOperationEnum(),
  version: integer().notNull().default(0),
  errorMessage: varchar({ length: 512 }),
  frozenAt: timestamp({ withTimezone: true }),
  /** 终态时间（captured / released / failed） */
  finishedAt: timestamp({ withTimezone: true }),
  remark: varchar({ length: 256 }),
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_preauths_operator_idx').on(t.operatorId), index('payment_preauths_tenant_idx').on(t.tenantId), 
  // 同一业务单最多一笔进行中预授权（发起中/冻结中）
  uniqueIndex('payment_preauths_active_biz_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.appId, t.bizType, t.bizId, t.currency)
    .where(sql`${t.status} in ('pending', 'unknown', 'frozen')`),
  index('payment_preauths_status_idx').on(t.status),
  index('payment_preauths_biz_idx').on(t.tenantId, t.appId, t.bizType, t.bizId, t.currency),
]);

export type PaymentPreauthRow = typeof paymentPreauths.$inferSelect;

export type NewPaymentPreauth = typeof paymentPreauths.$inferInsert;

// ─── 转账/代付单 ─────────────────────────────────────────────────────────────
export const paymentTransferStatusEnum = pgEnum('payment_transfer_status', ['pending', 'processing', 'unknown', 'success', 'failed']);
export const paymentTransferApprovalStatusEnum = pgEnum('payment_transfer_approval_status', ['none', 'pending', 'approved', 'rejected']);

export const paymentTransfers = pgTable('payment_transfers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  transferNo: varchar({ length: 64 }).notNull().unique('payment_transfers_transfer_no_unique'),
  /** 商户转账单号（渠道幂等键，与 transferNo 相同值单独存列便于对账） */
  outTransferNo: varchar({ length: 64 }).notNull(),
  channel: paymentChannelEnum().notNull(),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull().default('CNY'),
  /** 收款账号（微信 openid / 支付宝登录账号） */
  receiverAccount: varchar({ length: 128 }).notNull(),
  receiverName: varchar({ length: 64 }),
  amount: integer().notNull(),
  remark: varchar({ length: 256 }),
  status: paymentTransferStatusEnum().notNull().default('pending'),
  approvalStatus: paymentTransferApprovalStatusEnum().notNull().default('none'),
  appliedById: integer().references(() => users.id, { onDelete: 'set null' }),
  approverId: integer().references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp({ withTimezone: true }),
  approvalRemark: varchar({ length: 256 }),
  channelTransferNo: varchar({ length: 128 }),
  failReason: varchar({ length: 512 }),
  /** 渠道调用已尝试次数（仅渠道未受理的失败单可人工重试） */
  attempts: integer().notNull().default(0),
  idempotencyKey: varchar({ length: 128 }).notNull(),
  requestHash: varchar({ length: 64 }).notNull(),
  fundReservationId: integer().notNull().references((): AnyPgColumn => paymentFundReservations.id, { onDelete: 'restrict' }),
  version: integer().notNull().default(0),
  bizType: varchar({ length: 64 }),
  bizId: varchar({ length: 128 }),
  finishedAt: timestamp({ withTimezone: true }),
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_transfers_operator_idx').on(t.operatorId), index('payment_transfers_tenant_idx').on(t.tenantId), 
  unique('payment_transfers_config_out_no_uq').on(t.channelConfigId, t.outTransferNo),
  uniqueIndex('payment_transfers_idempotency_scope_uq').on(sql`coalesce(${t.tenantId}, 0)`, t.appId, t.idempotencyKey),
  index('payment_transfers_status_idx').on(t.status),
  index('payment_transfers_biz_idx').on(t.bizType, t.bizId),
]);

export type PaymentTransferRow = typeof paymentTransfers.$inferSelect;

export type NewPaymentTransfer = typeof paymentTransfers.$inferInsert;

// ─── 支付应用（开放平台客户端的一对一支付路由画像）────────────────────────────
export const paymentApps = pgTable('payment_apps', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  openClientId: integer().notNull().references(() => oauth2Clients.id, { onDelete: 'restrict' }),
  status: statusEnum().notNull().default('enabled'),
  wechatConfigId: integer().references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  alipayConfigId: integer().references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  unionpayConfigId: integer().references(() => paymentChannelConfigs.id, { onDelete: 'set null' }),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('payment_apps_tenant_idx').on(t.tenantId),
  unique('payment_apps_open_client_unique').on(t.openClientId),
]);

export type PaymentAppRow = typeof paymentApps.$inferSelect;

export type NewPaymentApp = typeof paymentApps.$inferInsert;

// ─── 支付方式配置 ─────────────────────────────────────────────────────────────
export const paymentMethodConfigs = pgTable('payment_method_configs', {  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  method: paymentMethodEnum().notNull(),
  channel: paymentChannelEnum().notNull(),
  label: varchar({ length: 64 }).notNull(),
  icon: varchar({ length: 128 }),
  enabled: boolean().notNull().default(true),
  sort: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('payment_method_configs_tenant_idx').on(t.tenantId),
  uniqueIndex('payment_method_configs_tenant_method_uq').on(sql`coalesce(${t.tenantId}, 0)`, t.method),
]);

export type PaymentMethodConfigRow = typeof paymentMethodConfigs.$inferSelect;

export type NewPaymentMethodConfig = typeof paymentMethodConfigs.$inferInsert;

// ─── 扣款计划（签约代扣的周期/金额模板）──────────────────────────────────────
export const paymentDeductPeriodEnum = pgEnum('payment_deduct_period', ['daily', 'weekly', 'monthly', 'custom']);

export const paymentDeductPlans = pgTable('payment_deduct_plans', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  period: paymentDeductPeriodEnum().notNull().default('monthly'),
  /** period=custom 时的自定义周期天数 */
  customDays: integer(),
  /** 每期扣款金额（分） */
  amount: integer().notNull(),
  /** 单期扣款连续失败重试上限，超过后协议自动暂停 */
  maxRetries: integer().notNull().default(3),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_deduct_plans_tenant_idx').on(t.tenantId)]);

export type PaymentDeductPlanRow = typeof paymentDeductPlans.$inferSelect;

export type NewPaymentDeductPlan = typeof paymentDeductPlans.$inferInsert;

// ─── 签约代扣协议（微信委托代扣 / 支付宝周期扣款）────────────────────────────
export const paymentContractStatusEnum = pgEnum('payment_contract_status', ['pending', 'unknown', 'signed', 'paused', 'terminated', 'failed']);

export const paymentContractOperationEnum = pgEnum('payment_contract_operation', ['sign', 'terminate']);

export const paymentContracts = pgTable('payment_contracts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  contractNo: varchar({ length: 64 }).notNull().unique('payment_contracts_contract_no_unique'),
  channel: paymentChannelEnum().notNull(),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull().default('CNY'),
  planId: integer().notNull().references(() => paymentDeductPlans.id, { onDelete: 'restrict' }),
  /** 签约账号（微信 openid / 支付宝账号 / 会员标识） */
  signerAccount: varchar({ length: 128 }).notNull(),
  signerName: varchar({ length: 64 }),
  status: paymentContractStatusEnum().notNull().default('pending'),
  unknownOperation: paymentContractOperationEnum(),
  version: integer().notNull().default(0),
  errorMessage: varchar({ length: 512 }),
  /** 渠道协议号（签约成功后回填） */
  channelContractNo: varchar({ length: 128 }),
  bizType: varchar({ length: 64 }).notNull(),
  bizId: varchar({ length: 128 }).notNull(),
  /** 下次扣款时间（signed 状态下由 cron 扫描执行） */
  nextDeductAt: timestamp({ withTimezone: true }),
  lastDeductAt: timestamp({ withTimezone: true }),
  /** 当前期连续扣款失败次数（成功后清零，达到计划 maxRetries 自动暂停） */
  failCount: integer().notNull().default(0),
  /** 累计成功扣款期数 */
  totalDeductCount: integer().notNull().default(0),
  /** 最近一期扣款订单号 */
  lastOrderNo: varchar({ length: 64 }),
  signedAt: timestamp({ withTimezone: true }),
  terminatedAt: timestamp({ withTimezone: true }),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_contracts_tenant_idx').on(t.tenantId), 
  // 同一业务单（bizType+bizId）最多一份未终止协议，防止重复签约
  uniqueIndex('payment_contracts_active_biz_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.appId, t.bizType, t.bizId, t.currency)
    .where(sql`${t.status} in ('pending', 'unknown', 'signed', 'paused')`),
  uniqueIndex('payment_contracts_member_renewal_active_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.bizType, t.bizId, t.currency)
    .where(sql`${t.bizType} = 'member_renewal' and ${t.status} in ('pending', 'unknown', 'signed', 'paused')`),
  index('payment_contracts_status_idx').on(t.status),
  index('payment_contracts_next_deduct_idx').on(t.nextDeductAt),
  index('payment_contracts_biz_idx').on(t.tenantId, t.appId, t.bizType, t.bizId, t.currency),
]);

export type PaymentContractRow = typeof paymentContracts.$inferSelect;

export type NewPaymentContract = typeof paymentContracts.$inferInsert;

// ─── 交易投诉/争议（微信支付投诉、支付宝交易投诉的本地聚合工单）──────────────
export const paymentDisputeTypeEnum = pgEnum('payment_dispute_type', ['refund_request', 'service_issue', 'fraud_report', 'other']);

export const paymentDisputeStatusEnum = pgEnum('payment_dispute_status', ['pending', 'processing', 'resolved', 'refunded']);

export const paymentDisputeReplyAuthorEnum = pgEnum('payment_dispute_reply_author', ['merchant', 'user', 'system']);

export const paymentDisputes = pgTable('payment_disputes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  disputeNo: varchar({ length: 64 }).notNull().unique('payment_disputes_dispute_no_unique'),
  /** 渠道投诉单号（微信 complaint_id / 支付宝反馈单号） */
  channelDisputeNo: varchar({ length: 128 }),
  channel: paymentChannelEnum().notNull(),
  /** 关联支付订单号（松耦合，与 payment_events 一致） */
  orderNo: varchar({ length: 64 }).notNull(),
  /** 投诉人标识（openid / 手机号掩码） */
  complainant: varchar({ length: 128 }),
  complainantPhone: varchar({ length: 32 }),
  /** 投诉类型 */
  type: paymentDisputeTypeEnum().notNull().default('other'),
  /** 投诉描述 */
  content: text().notNull(),
  /** 涉诉金额（分） */
  amount: integer().notNull().default(0),
  status: paymentDisputeStatusEnum().notNull().default('pending'),
  /** 智能分流路由（规则中心 dispute_triage 决策表输出；null=未分流走默认队列） */
  route: varchar({ length: 32 }),
  /** 分流优先级（数值越大越紧急；null=未分流） */
  priority: integer(),
  /** 分流建议 SLA（小时，写入 deadline 的依据留痕） */
  slaHours: integer(),
  /** 处理时效（超过未完结视为超时，触发预警） */
  deadline: timestamp({ withTimezone: true }),
  /** 关联退款单号（投诉退款后回填） */
  refundNo: varchar({ length: 64 }),
  /** 完结时间（resolved / refunded） */
  resolvedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('payment_disputes_tenant_idx').on(t.tenantId), 
  index('payment_disputes_status_idx').on(t.status),
  index('payment_disputes_order_no_idx').on(t.orderNo),
  index('payment_disputes_deadline_idx').on(t.deadline),
  index('payment_disputes_route_idx').on(t.route),
]);

export type PaymentDisputeRow = typeof paymentDisputes.$inferSelect;

export type NewPaymentDispute = typeof paymentDisputes.$inferInsert;

/** 投诉处理时间线（追加型日志：商户回复 / 用户补充 / 系统动作） */
export const paymentDisputeReplies = pgTable('payment_dispute_replies', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  disputeId: integer().notNull().references(() => paymentDisputes.id, { onDelete: 'cascade' }),
  author: paymentDisputeReplyAuthorEnum().notNull().default('merchant'),
  content: text().notNull(),
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('payment_dispute_replies_operator_idx').on(t.operatorId), index('payment_dispute_replies_dispute_idx').on(t.disputeId)]);

export type PaymentDisputeReplyRow = typeof paymentDisputeReplies.$inferSelect;

export type NewPaymentDisputeReply = typeof paymentDisputeReplies.$inferInsert;

// ─── 最终资金内核：不可变双分录、资金预占与结算逐笔归属 ───────────────────────

export const paymentLedgerAccountCodeEnum = pgEnum('payment_ledger_account_code', [
  'provider_clearing',
  'merchant_pending',
  'merchant_available',
  'merchant_frozen',
  'platform_fee',
  'refund_payable',
  'sharing_payable',
  'payout_payable',
  'suspense',
]);

export const paymentLedgerNormalBalanceEnum = pgEnum('payment_ledger_normal_balance', ['debit', 'credit']);

export const paymentLedgerAccounts = pgTable('payment_ledger_accounts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountNo: varchar({ length: 64 }).notNull().unique('payment_ledger_accounts_account_no_unique'),
  name: varchar({ length: 128 }).notNull(),
  code: paymentLedgerAccountCodeEnum().notNull(),
  normalBalance: paymentLedgerNormalBalanceEnum().notNull(),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull(),
  status: statusEnum().notNull().default('enabled'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'restrict' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('payment_ledger_accounts_scope_code_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.appId, t.channelConfigId, t.currency, t.code),
  index('payment_ledger_accounts_scope_idx').on(t.tenantId, t.appId, t.channelConfigId, t.currency),
]);

export type PaymentLedgerAccountRow = typeof paymentLedgerAccounts.$inferSelect;

export type NewPaymentLedgerAccount = typeof paymentLedgerAccounts.$inferInsert;

/** 已过账凭证只追加不修改；冲正通过 reversalOfJournalId 指向原凭证。 */
export const paymentJournals = pgTable('payment_journals', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  journalNo: varchar({ length: 64 }).notNull().unique('payment_journals_journal_no_unique'),
  sourceType: varchar({ length: 64 }).notNull(),
  sourceId: varchar({ length: 128 }).notNull(),
  requestHash: varchar({ length: 64 }).notNull(),
  description: varchar({ length: 512 }).notNull(),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull(),
  reversalOfJournalId: integer().references((): AnyPgColumn => paymentJournals.id, { onDelete: 'restrict' }),
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'restrict' }),
  postedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('payment_journals_source_scope_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.appId, t.channelConfigId, t.currency, t.sourceType, t.sourceId),
  uniqueIndex('payment_journals_reversal_once_uq')
    .on(t.reversalOfJournalId)
    .where(sql`${t.reversalOfJournalId} is not null`),
  index('payment_journals_scope_posted_idx').on(t.tenantId, t.appId, t.channelConfigId, t.currency, t.postedAt),
]);

export type PaymentJournalRow = typeof paymentJournals.$inferSelect;

export type NewPaymentJournal = typeof paymentJournals.$inferInsert;

export const paymentJournalLines = pgTable('payment_journal_lines', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  journalId: integer().notNull().references(() => paymentJournals.id, { onDelete: 'restrict' }),
  lineNo: integer().notNull(),
  accountId: integer().notNull().references(() => paymentLedgerAccounts.id, { onDelete: 'restrict' }),
  debitAmount: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
  creditAmount: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
  memo: varchar({ length: 256 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('payment_journal_lines_journal_line_unique').on(t.journalId, t.lineNo),
  index('payment_journal_lines_account_idx').on(t.accountId),
  check(
    'payment_journal_lines_single_side_check',
    sql`((${t.debitAmount} > 0 and ${t.creditAmount} = 0) or (${t.creditAmount} > 0 and ${t.debitAmount} = 0))`,
  ),
]);

export type PaymentJournalLineRow = typeof paymentJournalLines.$inferSelect;

export type NewPaymentJournalLine = typeof paymentJournalLines.$inferInsert;

export const paymentFundReservationStatusEnum = pgEnum('payment_fund_reservation_status', [
  'active',
  'captured',
  'released',
  'expired',
]);

export const paymentFundReservations = pgTable('payment_fund_reservations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  reservationNo: varchar({ length: 64 }).notNull().unique('payment_fund_reservations_reservation_no_unique'),
  accountId: integer().notNull().references(() => paymentLedgerAccounts.id, { onDelete: 'restrict' }),
  sourceType: varchar({ length: 64 }).notNull(),
  sourceId: varchar({ length: 128 }).notNull(),
  amount: bigint({ mode: 'bigint' }).notNull(),
  status: paymentFundReservationStatusEnum().notNull().default('active'),
  version: integer().notNull().default(0),
  reason: varchar({ length: 256 }),
  finalizationReason: varchar({ length: 256 }),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'restrict' }),
  expiresAt: timestamp({ withTimezone: true }),
  finalizedAt: timestamp({ withTimezone: true }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('payment_fund_reservations_source_scope_uq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.appId, t.channelConfigId, t.currency, t.sourceType, t.sourceId),
  index('payment_fund_reservations_active_account_idx').on(t.accountId, t.status, t.expiresAt),
  index('payment_fund_reservations_scope_idx').on(t.tenantId, t.appId, t.channelConfigId, t.currency),
  check('payment_fund_reservations_amount_positive_check', sql`${t.amount} > 0`),
]);

export type PaymentFundReservationRow = typeof paymentFundReservations.$inferSelect;

export type NewPaymentFundReservation = typeof paymentFundReservations.$inferInsert;

/** 结算批次逐笔认领 Journal Line；amount 为该行对可结算净额的带符号贡献。 */
export const paymentSettlementItems = pgTable('payment_settlement_items', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  batchId: integer().notNull().references(() => paymentSettlementBatches.id, { onDelete: 'restrict' }),
  journalLineId: integer().notNull().references(() => paymentJournalLines.id, { onDelete: 'restrict' }),
  amount: bigint({ mode: 'bigint' }).notNull(),
  appId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  currency: varchar({ length: 8 }).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'restrict' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('payment_settlement_items_journal_line_unique').on(t.journalLineId),
  unique('payment_settlement_items_batch_line_unique').on(t.batchId, t.journalLineId),
  index('payment_settlement_items_batch_idx').on(t.batchId),
  index('payment_settlement_items_scope_idx').on(t.tenantId, t.appId, t.channelConfigId, t.currency),
  check('payment_settlement_items_amount_nonzero_check', sql`${t.amount} <> 0`),
]);

export type PaymentSettlementItemRow = typeof paymentSettlementItems.$inferSelect;

export type NewPaymentSettlementItem = typeof paymentSettlementItems.$inferInsert;

// ─── 关系声明（Drizzle Relational Query API）──────────────────────────────────
// 声明后可使用 db.query.xxx.findMany({ with: { ... } }) 进行关联查询
