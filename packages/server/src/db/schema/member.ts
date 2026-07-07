import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, unique, uniqueIndex, index, jsonb, date, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum } from './common';
import { auditColumns, tenants, users } from './core';
import { loginStatusEnum } from './logs';
import { paymentOrders } from './payment';

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
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 32 }).notNull(),
  /** 等级序号（0=最低，数字越大等级越高，全局唯一）*/
  level: integer('level').notNull().default(0),
  /** 升至本等级所需的成长值门槛 */
  growthThreshold: integer('growth_threshold').notNull().default(0),
  /** 等级折扣（百分比，100=原价，95=95折）*/
  discount: integer('discount').notNull().default(100),
  icon: varchar('icon', { length: 256 }),
  /** 等级权益描述列表 */
  benefits: jsonb('benefits').$type<string[]>().notNull().default([]),
  description: varchar('description', { length: 256 }),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('member_levels_level_unique').on(t.level)]);

export type MemberLevelRow = typeof memberLevels.$inferSelect;

export type NewMemberLevel = typeof memberLevels.$inferInsert;

// ─── 会员主表（前台用户，全局唯一，保留 tenantId 备用，默认 null）──────────────
export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  /** 登录用户名（可空，全局唯一）*/
  username: varchar('username', { length: 32 }),
  /** 手机号（可空，全局唯一，国内主登录凭证）*/
  phone: varchar('phone', { length: 20 }),
  /** 邮箱（可空，全局唯一）*/
  email: varchar('email', { length: 128 }),
  /** bcrypt 密码哈希（纯验证码注册时可为空）*/
  password: varchar('password', { length: 128 }),
  nickname: varchar('nickname', { length: 32 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  gender: varchar('gender', { length: 20 }),
  birthday: varchar('birthday', { length: 20 }),
  status: memberStatusEnum('status').notNull().default('active'),
  levelId: integer('level_id').references((): AnyPgColumn => memberLevels.id, { onDelete: 'set null' }),
  /** 成长值（决定会员等级）*/
  growthValue: integer('growth_value').notNull().default(0),
  experience: integer('experience').notNull().default(0),
  /** 注册来源：web / h5 / app / admin */
  registerSource: varchar('register_source', { length: 32 }).notNull().default('web'),
  registerIp: varchar('register_ip', { length: 64 }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastLoginIp: varchar('last_login_ip', { length: 64 }),
  remark: varchar('remark', { length: 256 }),
  /** 软删除时间（非 null 即已删除；资金流水/券码等历史数据保留）*/
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  // 部分唯一索引：仅约束未删除的会员，软删除后手机号/邮箱/用户名可再次注册
  uniqueIndex('members_phone_unique').on(t.phone).where(sql`${t.deletedAt} is null`),
  uniqueIndex('members_email_unique').on(t.email).where(sql`${t.deletedAt} is null`),
  uniqueIndex('members_username_unique').on(t.username).where(sql`${t.deletedAt} is null`),
  index('members_status_idx').on(t.status),
]);

export type MemberRow = typeof members.$inferSelect;

export type NewMember = typeof members.$inferInsert;

// ─── 会员积分账户表（一会员一账户，version 乐观锁）──────────────────────────────
export const memberPointAccounts = pgTable('member_point_accounts', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 当前可用积分 */
  balance: integer('balance').notNull().default(0),
  /** 冻结积分 */
  frozen: integer('frozen').notNull().default(0),
  /** 累计获得积分 */
  totalEarned: integer('total_earned').notNull().default(0),
  /** 累计消耗积分 */
  totalSpent: integer('total_spent').notNull().default(0),
  /** 乐观锁版本号 */
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [uniqueIndex('member_point_accounts_member_unique').on(t.memberId)]);

export type MemberPointAccountRow = typeof memberPointAccounts.$inferSelect;

export type NewMemberPointAccount = typeof memberPointAccounts.$inferInsert;

// ─── 会员积分流水表（追加型）──────────────────────────────────────────────────
export const memberPointTransactions = pgTable('member_point_transactions', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  type: pointTxTypeEnum('type').notNull(),
  /** 积分变动量（正=增加，负=减少）*/
  amount: integer('amount').notNull(),
  /** 变动后余额 */
  balanceAfter: integer('balance_after').notNull(),
  /** 业务类型：signin / purchase / redeem / admin_adjust / refund ... */
  bizType: varchar('biz_type', { length: 64 }),
  bizId: varchar('biz_id', { length: 128 }),
  remark: varchar('remark', { length: 256 }),
  /** 后台操作人（管理员手动调整时记录）*/
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('member_point_tx_member_idx').on(t.memberId),
  index('member_point_tx_biz_idx').on(t.bizType, t.bizId),
]);

export type MemberPointTransactionRow = typeof memberPointTransactions.$inferSelect;

export type NewMemberPointTransaction = typeof memberPointTransactions.$inferInsert;

// ─── 会员钱包账户表（余额单位：分，version 乐观锁）─────────────────────────────
export const memberWallets = pgTable('member_wallets', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 余额（分）*/
  balance: integer('balance').notNull().default(0),
  /** 冻结金额（分）*/
  frozen: integer('frozen').notNull().default(0),
  /** 累计充值（分）*/
  totalRecharge: integer('total_recharge').notNull().default(0),
  /** 累计消费（分）*/
  totalConsume: integer('total_consume').notNull().default(0),
  /** 乐观锁版本号 */
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [uniqueIndex('member_wallets_member_unique').on(t.memberId)]);

export type MemberWalletRow = typeof memberWallets.$inferSelect;

export type NewMemberWallet = typeof memberWallets.$inferInsert;

// ─── 会员钱包流水表（追加型）──────────────────────────────────────────────────
export const memberWalletTransactions = pgTable('member_wallet_transactions', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  type: walletTxTypeEnum('type').notNull(),
  /** 金额变动（分，正=增加，负=减少）*/
  amount: integer('amount').notNull(),
  /** 变动后余额（分）*/
  balanceAfter: integer('balance_after').notNull(),
  bizType: varchar('biz_type', { length: 64 }),
  bizId: varchar('biz_id', { length: 128 }),
  /** 充值时关联的支付订单 */
  paymentOrderId: integer('payment_order_id').references(() => paymentOrders.id, { onDelete: 'set null' }),
  remark: varchar('remark', { length: 256 }),
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('member_wallet_tx_member_idx').on(t.memberId),
  index('member_wallet_tx_biz_idx').on(t.bizType, t.bizId),
]);

export type MemberWalletTransactionRow = typeof memberWalletTransactions.$inferSelect;

export type NewMemberWalletTransaction = typeof memberWalletTransactions.$inferInsert;

// ─── 优惠券模板表 ─────────────────────────────────────────────────────────────
export const coupons = pgTable('coupons', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  /** amount=满减券, percent=折扣券 */
  type: couponTypeEnum('type').notNull(),
  /** 面值：amount 型为减免金额（分）；percent 型为折扣百分比（90=9折）*/
  faceValue: integer('face_value').notNull(),
  /** 使用门槛（分），0=无门槛 */
  threshold: integer('threshold').notNull().default(0),
  /** 折扣券最高减免金额（分），可空 */
  maxDiscount: integer('max_discount'),
  /** 发行总量，0=不限量 */
  totalQuantity: integer('total_quantity').notNull().default(0),
  /** 已发放数量 */
  issuedQuantity: integer('issued_quantity').notNull().default(0),
  /** 每人限领数量 */
  perLimit: integer('per_limit').notNull().default(1),
  /** 有效期类型：fixed=固定起止日期，relative=领取后 N 天 */
  validType: couponValidTypeEnum('valid_type').notNull().default('fixed'),
  validStart: timestamp('valid_start', { withTimezone: true }),
  validEnd: timestamp('valid_end', { withTimezone: true }),
  /** relative 型：领取后有效天数 */
  validDays: integer('valid_days'),
  status: couponTemplateStatusEnum('status').notNull().default('draft'),
  description: varchar('description', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('coupons_status_idx').on(t.status)]);

export type CouponRow = typeof coupons.$inferSelect;

export type NewCoupon = typeof coupons.$inferInsert;

// ─── 会员优惠券（券码 / 领取记录）─────────────────────────────────────────────
export const memberCoupons = pgTable('member_coupons', {
  id: serial('id').primaryKey(),
  couponId: integer('coupon_id').notNull().references(() => coupons.id, { onDelete: 'cascade' }),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  /** 券码（全局唯一）*/
  code: varchar('code', { length: 32 }).notNull().unique(),
  status: memberCouponStatusEnum('status').notNull().default('unused'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  /** 实际过期时间（领取时按模板计算并固化）*/
  expireAt: timestamp('expire_at', { withTimezone: true }),
  /** 核销业务类型 / 单号（预留给未来订单系统）*/
  bizType: varchar('biz_type', { length: 64 }),
  bizId: varchar('biz_id', { length: 128 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('member_coupons_member_idx').on(t.memberId),
  index('member_coupons_coupon_idx').on(t.couponId),
  index('member_coupons_status_idx').on(t.status),
]);

export type MemberCouponRow = typeof memberCoupons.$inferSelect;

export type NewMemberCoupon = typeof memberCoupons.$inferInsert;

// ─── 会员登录日志表 ──────────────────────────────────────────────────────────
export const memberLoginLogs = pgTable('member_login_logs', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'cascade' }),
  ip: varchar('ip', { length: 64 }),
  location: varchar('location', { length: 128 }),
  browser: varchar('browser', { length: 64 }),
  os: varchar('os', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  status: loginStatusEnum('status').notNull(),
  message: varchar('message', { length: 256 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MemberLoginLogRow = typeof memberLoginLogs.$inferSelect;

export type NewMemberLoginLog = typeof memberLoginLogs.$inferInsert;

// ─── 签到规则 ──────────────────────────────────────────────────────────────────
export const checkinRules = pgTable('checkin_rules', {
  id: serial('id').primaryKey(),
  dayNumber: integer('day_number').notNull(),
  points: integer('points').notNull().default(0),
  experience: integer('experience').notNull().default(0),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique().on(t.dayNumber),
]);

export type CheckinRuleRow = typeof checkinRules.$inferSelect;

export type NewCheckinRule = typeof checkinRules.$inferInsert;

// ─── 会员签到记录 ───────────────────────────────────────────────────────────────
export const memberCheckins = pgTable('member_checkins', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  checkinDate: date('checkin_date').notNull(),
  consecutiveDays: integer('consecutive_days').notNull().default(1),
  pointsAwarded: integer('points_awarded').notNull().default(0),
  experienceAwarded: integer('experience_awarded').notNull().default(0),
  isMakeup: boolean('is_makeup').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique().on(t.memberId, t.checkinDate),
]);

export type MemberCheckinRow = typeof memberCheckins.$inferSelect;

export type NewMemberCheckin = typeof memberCheckins.$inferInsert;

// ─── 签到设置（单行配置：补签开关 / 消耗积分 / 可回溯天数）────────────────────────
export const checkinSettings = pgTable('checkin_settings', {
  id: serial('id').primaryKey(),
  makeupEnabled: boolean('makeup_enabled').notNull().default(true),
  makeupCostPoints: integer('makeup_cost_points').notNull().default(20),
  makeupMaxDays: integer('makeup_max_days').notNull().default(7),
  ...auditColumns(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CheckinSettingsRow = typeof checkinSettings.$inferSelect;

export type NewCheckinSettings = typeof checkinSettings.$inferInsert;

// ─── 签到里程碑（累计签到天数达标奖励）──────────────────────────────────────────
export const checkinMilestoneRewardTypeEnum = pgEnum('checkin_milestone_reward_type', ['points', 'coupon']);

export const checkinMilestones = pgTable('checkin_milestones', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 64 }).notNull(),
  cumulativeDays: integer('cumulative_days').notNull(),
  rewardType: checkinMilestoneRewardTypeEnum('reward_type').notNull().default('points'),
  rewardPoints: integer('reward_points').notNull().default(0),
  couponId: integer('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique().on(t.cumulativeDays),
]);

export type CheckinMilestoneRow = typeof checkinMilestones.$inferSelect;

export type NewCheckinMilestone = typeof checkinMilestones.$inferInsert;

// ─── 会员里程碑发放记录（防重复发放）──────────────────────────────────────────
export const memberCheckinMilestoneAwards = pgTable('member_checkin_milestone_awards', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  milestoneId: integer('milestone_id').notNull().references(() => checkinMilestones.id, { onDelete: 'cascade' }),
  cumulativeDays: integer('cumulative_days').notNull(),
  rewardType: checkinMilestoneRewardTypeEnum('reward_type').notNull(),
  rewardPoints: integer('reward_points').notNull().default(0),
  couponId: integer('coupon_id'),
  memberCouponId: integer('member_coupon_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique().on(t.memberId, t.milestoneId),
]);

export type MemberCheckinMilestoneAwardRow = typeof memberCheckinMilestoneAwards.$inferSelect;

export type NewMemberCheckinMilestoneAward = typeof memberCheckinMilestoneAwards.$inferInsert;
