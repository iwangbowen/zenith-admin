import { pgTable, varchar, timestamp, pgEnum, integer, boolean, unique, uniqueIndex, index, jsonb, date, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';
import { loginStatusEnum } from './logs';

// ─── 会员相关枚举（三端同步：pgEnum / TS union / Zod enum）───────────────────
export const memberStatusEnum = pgEnum('member_status', ['active', 'inactive', 'banned']);

export const pointTxTypeEnum = pgEnum('point_tx_type', ['earn', 'redeem', 'expire', 'adjust', 'refund']);

export const walletTxTypeEnum = pgEnum('wallet_tx_type', ['recharge', 'consume', 'refund', 'adjust']);

export const couponTypeEnum = pgEnum('coupon_type', ['amount', 'percent']);

export const couponValidTypeEnum = pgEnum('coupon_valid_type', ['fixed', 'relative']);

export const couponTemplateStatusEnum = pgEnum('coupon_template_status', ['draft', 'active', 'paused', 'expired']);

export const memberCouponStatusEnum = pgEnum('member_coupon_status', ['unused', 'used', 'expired', 'frozen']);

// ─── 会员等级配置表 ───────────────────────────────────────────────────────────
export const memberLevels = pgTable('member_levels', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 32 }).notNull(),
  /** 等级序号（0=最低，数字越大等级越高，全局唯一）*/
  level: integer().notNull().default(0),
  /** 升至本等级所需的成长值门槛 */
  growthThreshold: integer().notNull().default(0),
  /** 等级折扣（百分比，100=原价，95=95折）*/
  discount: integer().notNull().default(100),
  icon: varchar({ length: 256 }),
  /** 等级权益描述列表 */
  benefits: jsonb().$type<string[]>().notNull().default([]),
  description: varchar({ length: 256 }),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('member_levels_level_unique').on(t.level)]);

export type MemberLevelRow = typeof memberLevels.$inferSelect;

export type NewMemberLevel = typeof memberLevels.$inferInsert;

// ─── 会员主表（前台用户，全局唯一，保留 tenantId 备用，默认 null）──────────────
export const members = pgTable('members', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 登录用户名（可空，全局唯一）*/
  username: varchar({ length: 32 }),
  /** 手机号（可空，全局唯一，国内主登录凭证）*/
  phone: varchar({ length: 20 }),
  /** 邮箱（可空，全局唯一）*/
  email: varchar({ length: 128 }),
  /** bcrypt 密码哈希（纯验证码注册时可为空）*/
  password: varchar({ length: 128 }),
  nickname: varchar({ length: 32 }).notNull(),
  avatar: varchar({ length: 256 }),
  gender: varchar({ length: 20 }),
  birthday: varchar({ length: 20 }),
  status: memberStatusEnum().notNull().default('active'),
  levelId: integer().references((): AnyPgColumn => memberLevels.id, { onDelete: 'set null' }),
  /** 付费会员（VIP）有效期，null = 未开通；由自动续费扣款成功延长 */
  vipExpireAt: timestamp({ withTimezone: true }),
  /** 成长值（决定会员等级）*/
  growthValue: integer().notNull().default(0),
  experience: integer().notNull().default(0),
  /** 注册来源：web / h5 / app / admin */
  registerSource: varchar({ length: 32 }).notNull().default('web'),
  registerIp: varchar({ length: 64 }),
  lastLoginAt: timestamp({ withTimezone: true }),
  lastLoginIp: varchar({ length: 64 }),
  remark: varchar({ length: 256 }),
  /** 软删除时间（非 null 即已删除；资金流水/券码等历史数据保留）*/
  deletedAt: timestamp({ withTimezone: true }),
  /** 邀请码（懒生成，全局唯一）*/
  inviteCode: varchar({ length: 16 }),
  /** 邀请人会员 ID */
  invitedBy: integer().references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('members_tenant_idx').on(t.tenantId), 
  // 部分唯一索引：仅约束未删除的会员，软删除后手机号/邮箱/用户名可再次注册
  uniqueIndex('members_phone_unique').on(t.phone).where(sql`${t.deletedAt} is null`),
  uniqueIndex('members_email_unique').on(t.email).where(sql`${t.deletedAt} is null`),
  uniqueIndex('members_username_unique').on(t.username).where(sql`${t.deletedAt} is null`),
  uniqueIndex('members_invite_code_unique').on(t.inviteCode).where(sql`${t.inviteCode} is not null`),
  index('members_status_idx').on(t.status),
  index('members_invited_by_idx').on(t.invitedBy),
]);

export type MemberRow = typeof members.$inferSelect;

export type NewMember = typeof members.$inferInsert;

// ─── VIP 续费记录（自动续费扣款成功的幂等键 + 前台续费历史）────────────────────
export const memberVipRenewals = pgTable('member_vip_renewals', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 支付订单号（唯一，防事件重投重复延期） */
  orderNo: varchar({ length: 64 }).notNull().unique('member_vip_renewals_order_no_unique'),
  contractNo: varchar({ length: 64 }),
  /** 实扣金额（分） */
  amount: integer().notNull(),
  /** 本次续费后的 VIP 到期时间 */
  vipExpireAfter: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('member_vip_renewals_member_idx').on(t.memberId)]);

export type MemberVipRenewalRow = typeof memberVipRenewals.$inferSelect;

export type NewMemberVipRenewal = typeof memberVipRenewals.$inferInsert;

// ─── 会员标签（运营分群基础）──────────────────────────────────────────────────
export const memberTags = pgTable('member_tags', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 32 }).notNull(),
  /** 展示颜色（Semi Tag color 或 hex）*/
  color: varchar({ length: 20 }),
  description: varchar({ length: 256 }),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('member_tags_name_unique').on(t.name)]);

export type MemberTagRow = typeof memberTags.$inferSelect;

export type NewMemberTag = typeof memberTags.$inferInsert;

// ─── 会员-标签绑定 ────────────────────────────────────────────────────────────
export const memberTagBindings = pgTable('member_tag_bindings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  tagId: integer().notNull().references(() => memberTags.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('member_tag_bindings_unique').on(t.memberId, t.tagId),
  index('member_tag_bindings_tag_idx').on(t.tagId),
]);

export type MemberTagBindingRow = typeof memberTagBindings.$inferSelect;

export type NewMemberTagBinding = typeof memberTagBindings.$inferInsert;

// ─── 会员积分账户表（一会员一账户，version 乐观锁）──────────────────────────────
export const memberPointAccounts = pgTable('member_point_accounts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 当前可用积分 */
  balance: integer().notNull().default(0),
  /** 冻结积分 */
  frozen: integer().notNull().default(0),
  /** 累计获得积分 */
  totalEarned: integer().notNull().default(0),
  /** 累计消耗积分 */
  totalSpent: integer().notNull().default(0),
  /** 乐观锁版本号 */
  version: integer().notNull().default(0),
  ...timestampColumns(),
}, (t) => [uniqueIndex('member_point_accounts_member_unique').on(t.memberId)]);

export type MemberPointAccountRow = typeof memberPointAccounts.$inferSelect;

export type NewMemberPointAccount = typeof memberPointAccounts.$inferInsert;

// ─── 会员积分流水表（追加型）──────────────────────────────────────────────────
export const memberPointTransactions = pgTable('member_point_transactions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  type: pointTxTypeEnum().notNull(),
  /** 积分变动量（正=增加，负=减少）*/
  amount: integer().notNull(),
  /** 变动后余额 */
  balanceAfter: integer().notNull(),
  /** 业务类型：signin / purchase / redeem / admin_adjust / refund ... */
  bizType: varchar({ length: 64 }),
  bizId: varchar({ length: 128 }),
  remark: varchar({ length: 256 }),
  /** 后台操作人（管理员手动调整时记录）*/
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('member_point_transactions_operator_idx').on(t.operatorId), 
  index('member_point_tx_member_idx').on(t.memberId),
  index('member_point_tx_biz_idx').on(t.bizType, t.bizId),
]);

export type MemberPointTransactionRow = typeof memberPointTransactions.$inferSelect;

export type NewMemberPointTransaction = typeof memberPointTransactions.$inferInsert;

// ─── 会员钱包账户表（余额单位：分，version 乐观锁）─────────────────────────────
export const memberWallets = pgTable('member_wallets', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 余额（分）*/
  balance: integer().notNull().default(0),
  /** 冻结金额（分）*/
  frozen: integer().notNull().default(0),
  /** 累计充值（分）*/
  totalRecharge: integer().notNull().default(0),
  /** 累计消费（分）*/
  totalConsume: integer().notNull().default(0),
  /** 乐观锁版本号 */
  version: integer().notNull().default(0),
  ...timestampColumns(),
}, (t) => [uniqueIndex('member_wallets_member_unique').on(t.memberId)]);

export type MemberWalletRow = typeof memberWallets.$inferSelect;

export type NewMemberWallet = typeof memberWallets.$inferInsert;

// ─── 会员钱包流水表（追加型）──────────────────────────────────────────────────
export const memberWalletTransactions = pgTable('member_wallet_transactions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  type: walletTxTypeEnum().notNull(),
  /** 金额变动（分，正=增加，负=减少）*/
  amount: integer().notNull(),
  /** 变动后余额（分）*/
  balanceAfter: integer().notNull(),
  bizType: varchar({ length: 64 }),
  bizId: varchar({ length: 128 }),
  /** 充值履约引用的不可变支付意图号与事件 ID；不直接外键依赖支付内部表。 */
  paymentIntentNo: varchar({ length: 64 }),
  paymentEventId: varchar({ length: 128 }),
  remark: varchar({ length: 256 }),
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('member_wallet_transactions_operator_idx').on(t.operatorId), 
  index('member_wallet_tx_member_idx').on(t.memberId),
  index('member_wallet_tx_biz_idx').on(t.bizType, t.bizId),
  uniqueIndex('member_wallet_tx_payment_event_uq').on(t.paymentEventId).where(sql`${t.paymentEventId} is not null`),
]);

export type MemberWalletTransactionRow = typeof memberWalletTransactions.$inferSelect;

export type NewMemberWalletTransaction = typeof memberWalletTransactions.$inferInsert;

// ─── 优惠券模板表 ─────────────────────────────────────────────────────────────
export const coupons = pgTable('coupons', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  /** amount=满减券, percent=折扣券 */
  type: couponTypeEnum().notNull(),
  /** 面值：amount 型为减免金额（分）；percent 型为折扣百分比（90=9折）*/
  faceValue: integer().notNull(),
  /** 使用门槛（分），0=无门槛 */
  threshold: integer().notNull().default(0),
  /** 折扣券最高减免金额（分），可空 */
  maxDiscount: integer(),
  /** 发行总量，0=不限量 */
  totalQuantity: integer().notNull().default(0),
  /** 已发放数量 */
  issuedQuantity: integer().notNull().default(0),
  /** 每人限领数量 */
  perLimit: integer().notNull().default(1),
  /** 有效期类型：fixed=固定起止日期，relative=领取后 N 天 */
  validType: couponValidTypeEnum().notNull().default('fixed'),
  validStart: timestamp({ withTimezone: true }),
  validEnd: timestamp({ withTimezone: true }),
  /** relative 型：领取后有效天数 */
  validDays: integer(),
  /** 积分兑换所需积分（0 = 不可积分兑换）*/
  exchangePoints: integer().notNull().default(0),
  status: couponTemplateStatusEnum().notNull().default('draft'),
  description: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('coupons_tenant_idx').on(t.tenantId), index('coupons_status_idx').on(t.status)]);

export type CouponRow = typeof coupons.$inferSelect;

export type NewCoupon = typeof coupons.$inferInsert;

// ─── 会员优惠券（券码 / 领取记录）─────────────────────────────────────────────
export const memberCoupons = pgTable('member_coupons', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  couponId: integer().notNull().references(() => coupons.id, { onDelete: 'cascade' }),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 券码（全局唯一）*/
  code: varchar({ length: 32 }).notNull().unique(),
  status: memberCouponStatusEnum().notNull().default('unused'),
  receivedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  usedAt: timestamp({ withTimezone: true }),
  /** 实际过期时间（领取时按模板计算并固化）*/
  expireAt: timestamp({ withTimezone: true }),
  /** 核销业务类型 / 单号（预留给未来订单系统）*/
  bizType: varchar({ length: 64 }),
  bizId: varchar({ length: 128 }),
  ...timestampColumns(),
}, (t) => [
  index('member_coupons_member_idx').on(t.memberId),
  index('member_coupons_coupon_idx').on(t.couponId),
  index('member_coupons_status_idx').on(t.status),
]);

export type MemberCouponRow = typeof memberCoupons.$inferSelect;

export type NewMemberCoupon = typeof memberCoupons.$inferInsert;

// ─── 会员登录日志表 ──────────────────────────────────────────────────────────
export const memberLoginLogs = pgTable('member_login_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().references(() => members.id, { onDelete: 'cascade' }),
  ip: varchar({ length: 64 }),
  location: varchar({ length: 128 }),
  browser: varchar({ length: 64 }),
  os: varchar({ length: 64 }),
  userAgent: varchar({ length: 512 }),
  status: loginStatusEnum().notNull(),
  message: varchar({ length: 256 }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 后台按会员查询登录轨迹 + 清理任务按时间扫描
  index('member_login_logs_member_created_idx').on(t.memberId, t.createdAt),
]);

export type MemberLoginLogRow = typeof memberLoginLogs.$inferSelect;

export type NewMemberLoginLog = typeof memberLoginLogs.$inferInsert;

// ─── 签到规则 ──────────────────────────────────────────────────────────────────
export const checkinRules = pgTable('checkin_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  dayNumber: integer().notNull(),
  points: integer().notNull().default(0),
  experience: integer().notNull().default(0),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('checkin_rules_day_number_unique').on(t.dayNumber),
]);

export type CheckinRuleRow = typeof checkinRules.$inferSelect;

export type NewCheckinRule = typeof checkinRules.$inferInsert;

// ─── 会员签到记录 ───────────────────────────────────────────────────────────────
export const memberCheckins = pgTable('member_checkins', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  checkinDate: date().notNull(),
  consecutiveDays: integer().notNull().default(1),
  pointsAwarded: integer().notNull().default(0),
  experienceAwarded: integer().notNull().default(0),
  isMakeup: boolean().notNull().default(false),
  /** 备注（管理端补签时记录补签原因）*/
  remark: varchar({ length: 256 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('member_checkins_member_id_checkin_date_unique').on(t.memberId, t.checkinDate),
]);

export type MemberCheckinRow = typeof memberCheckins.$inferSelect;

export type NewMemberCheckin = typeof memberCheckins.$inferInsert;

// ─── 签到设置（单行配置：补签开关 / 消耗积分 / 可回溯天数）────────────────────────
export const checkinSettings = pgTable('checkin_settings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  makeupEnabled: boolean().notNull().default(true),
  makeupCostPoints: integer().notNull().default(20),
  makeupMaxDays: integer().notNull().default(7),
  ...auditColumns(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CheckinSettingsRow = typeof checkinSettings.$inferSelect;

export type NewCheckinSettings = typeof checkinSettings.$inferInsert;

// ─── 签到里程碑（累计签到天数达标奖励）──────────────────────────────────────────
export const checkinMilestoneRewardTypeEnum = pgEnum('checkin_milestone_reward_type', ['points', 'coupon']);

export const checkinMilestones = pgTable('checkin_milestones', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  title: varchar({ length: 64 }).notNull(),
  cumulativeDays: integer().notNull(),
  rewardType: checkinMilestoneRewardTypeEnum().notNull().default('points'),
  rewardPoints: integer().notNull().default(0),
  couponId: integer().references(() => coupons.id, { onDelete: 'set null' }),
  enabled: boolean().notNull().default(true),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('checkin_milestones_cumulative_days_unique').on(t.cumulativeDays),
]);

export type CheckinMilestoneRow = typeof checkinMilestones.$inferSelect;

export type NewCheckinMilestone = typeof checkinMilestones.$inferInsert;

// ─── 会员里程碑发放记录（防重复发放）──────────────────────────────────────────
export const memberCheckinMilestoneAwards = pgTable('member_checkin_milestone_awards', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  milestoneId: integer().notNull().references(() => checkinMilestones.id, { onDelete: 'cascade' }),
  cumulativeDays: integer().notNull(),
  rewardType: checkinMilestoneRewardTypeEnum().notNull(),
  rewardPoints: integer().notNull().default(0),
  couponId: integer(),
  memberCouponId: integer(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('member_checkin_milestone_awards_member_id_milestone_id_unique').on(t.memberId, t.milestoneId),
]);

export type MemberCheckinMilestoneAwardRow = typeof memberCheckinMilestoneAwards.$inferSelect;

export type NewMemberCheckinMilestoneAward = typeof memberCheckinMilestoneAwards.$inferInsert;

// ─── 会员站内通知 ─────────────────────────────────────────────────────────────
export const memberNotifications = pgTable('member_notifications', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 通知类型：birthday / coupon_expiring / point_adjust / wallet_adjust / invite_reward / system ... */
  type: varchar({ length: 32 }).notNull(),
  title: varchar({ length: 128 }).notNull(),
  content: varchar({ length: 512 }),
  /** 业务标识（配合 type 做防重，如券记录 ID / 年份）*/
  bizId: varchar({ length: 128 }),
  readAt: timestamp({ withTimezone: true }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('member_notifications_member_idx').on(t.memberId, t.createdAt),
  index('member_notifications_biz_idx').on(t.type, t.bizId),
  uniqueIndex('member_notifications_member_type_biz_uq')
    .on(t.memberId, t.type, t.bizId)
    .where(sql`${t.bizId} is not null and ${t.type} = 'cms_content_published'`),
]);

export type MemberNotificationRow = typeof memberNotifications.$inferSelect;

export type NewMemberNotification = typeof memberNotifications.$inferInsert;
