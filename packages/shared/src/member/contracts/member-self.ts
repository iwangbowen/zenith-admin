import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CASHIER_METHODS, PAYMENT_CHANNELS, PAYMENT_DEDUCT_METHODS, PAYMENT_METHODS } from '../../payment/constants';
import { MEMBER_COUPON_STATUSES, POINT_TX_TYPES, WALLET_TX_TYPES } from '../constants';
import { memberCouponTemplateSchema, memberMakeupCheckinSchema, memberWalletRechargeSchema } from '../validation';
import { couponSchema, memberCouponSchema } from './coupons';
import {
  makeupCheckinResultSchema,
  memberCheckinResultSchema,
  memberCheckinSchema,
  memberCheckinStatusSchema,
  memberMilestoneStatusSchema,
} from './member-checkins';
import { memberLevelSchema } from './member-levels';
import { memberPointAccountSchema, memberPointTransactionSchema } from './member-points';
import { memberWalletSchema, memberWalletTransactionSchema } from './member-wallets';
import { memberLoginLogSchema } from './members';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 发起充值后交给前端的支付参数（按支付方式不同而不同；支付域实体的会员侧精简视图） */
export const memberWalletRechargeResultSchema = z.object({
  orderNo: z.string(),
  payMethod: z.enum(PAYMENT_METHODS),
  channel: z.enum(PAYMENT_CHANNELS),
  codeUrl: z.string().optional().meta({ description: '微信 native：二维码内容' }),
  payUrl: z.string().optional().meta({ description: '跳转链接（支付宝 page / wap、微信 h5）' }),
  formHtml: z.string().optional().meta({ description: '支付宝 page 自动提交表单 HTML' }),
  jsapiParams: z.record(z.string(), z.string()).optional().meta({ description: '微信 JSAPI 调起参数' }),
  appOrderStr: z.string().optional().meta({ description: 'APP 支付客户端调起字符串' }),
  expiredAt: z.string().optional(),
}).meta({ id: 'MemberWalletRechargeResult' });

export type MemberWalletRechargeResult = z.infer<typeof memberWalletRechargeResultSchema>;

/** 会员可用的支付应用及其收银 / 代扣方式 */
export const memberPaymentApplicationOptionSchema = z.object({
  id: z.int(),
  name: z.string(),
  cashierMethods: z.array(z.object({
    method: z.enum(PAYMENT_CASHIER_METHODS),
    label: z.string(),
    icon: z.string().nullable(),
  })),
  deductMethods: z.array(z.object({
    method: z.enum(PAYMENT_DEDUCT_METHODS),
    label: z.string(),
  })),
}).meta({ id: 'MemberPaymentApplicationOption' });

export type MemberPaymentApplicationOption = z.infer<typeof memberPaymentApplicationOptionSchema>;

/** 会员站内通知 */
export const memberNotificationSchema = z.object({
  id: z.int(),
  memberId: z.int(),
  type: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'MemberNotification' });

export type MemberNotification = z.infer<typeof memberNotificationSchema>;

/** 会员权益（等级折扣与升级进度） */
export const memberBenefitsSchema = z.object({
  growthValue: z.int(),
  discount: z.int().meta({ description: '折扣百分比（100 = 原价）' }),
  levelId: z.int().nullable(),
  levelName: z.string().nullable(),
  benefits: z.array(z.string()),
  nextLevel: z.object({
    id: z.int(),
    name: z.string(),
    growthThreshold: z.int(),
    discount: z.int(),
    growthGap: z.int().meta({ description: '距升级还差的成长值' }),
  }).nullable(),
}).meta({ id: 'MemberBenefits' });

export type MemberBenefits = z.infer<typeof memberBenefitsSchema>;

/** 会员邀请汇总 */
export const memberInviteSummarySchema = z.object({
  inviteCode: z.string(),
  invitedCount: z.int(),
  totalRewardPoints: z.int(),
  recentInvitees: z.array(z.object({ id: z.int(), nickname: z.string(), createdAt: z.string() })),
}).meta({ id: 'MemberInviteSummary' });

export type MemberInviteSummary = z.infer<typeof memberInviteSummarySchema>;

// ─── 契约（会员登录态自助接口） ─────────────────────────────────────────────

export const memberPointTransactionQuery = paginationQuery.extend({ type: z.enum(POINT_TX_TYPES).optional() });

export const memberWalletTransactionQuery = paginationQuery.extend({ type: z.enum(WALLET_TX_TYPES).optional() });

export const memberCouponListQuery = paginationQuery.extend({ status: z.enum(MEMBER_COUPON_STATUSES).optional() });

export const memberCheckinHistoryQuery = paginationQuery.extend({
  dateStart: dateRangeBound('起始日期'),
  dateEnd: dateRangeBound('结束日期'),
});

export const memberNotificationListQuery = paginationQuery.extend({ unreadOnly: queryBool('仅未读') });

export const memberSelfContract = defineContract('/api/member', {
  pointAccount: op.get('/points/account', { response: memberPointAccountSchema, summary: '我的积分账户' }),
  pointTransactions: op.get('/points/transactions', { query: memberPointTransactionQuery, response: paginated(memberPointTransactionSchema), summary: '我的积分流水' }),
  wallet: op.get('/wallet', { response: memberWalletSchema, summary: '我的钱包' }),
  paymentOptions: op.get('/payment-options', { response: z.array(memberPaymentApplicationOptionSchema), summary: '会员可用支付应用与方式' }),
  walletTransactions: op.get('/wallet/transactions', { query: memberWalletTransactionQuery, response: paginated(memberWalletTransactionSchema), summary: '我的钱包流水' }),
  recharge: op.post('/wallet/recharge', { body: memberWalletRechargeSchema, response: memberWalletRechargeResultSchema, summary: '发起钱包充值' }),
  // 等级体系属于公开营销信息（落地页「等级体系」也要展示），不做登录门槛
  levels: op.get('/levels', { response: z.array(memberLevelSchema), summary: '会员等级权益列表', public: true }),
  benefits: op.get('/benefits', { response: memberBenefitsSchema, summary: '我的权益（折扣与升级进度）' }),
  checkinStatus: op.get('/checkin/status', { response: memberCheckinStatusSchema, summary: '今日签到状态' }),
  checkin: op.post('/checkin', { response: memberCheckinResultSchema, summary: '执行签到' }),
  checkinHistory: op.get('/checkin/history', { query: memberCheckinHistoryQuery, response: paginated(memberCheckinSchema), summary: '我的签到历史' }),
  makeupCheckin: op.post('/checkin/makeup', { body: memberMakeupCheckinSchema, response: makeupCheckinResultSchema, summary: '自助补签（消耗积分）' }),
  checkinMilestones: op.get('/checkin/milestones', { response: memberMilestoneStatusSchema, summary: '我的签到里程碑' }),
  availableCoupons: op.get('/coupons/available', { response: z.array(couponSchema), summary: '可领取的优惠券' }),
  exchangeableCoupons: op.get('/coupons/exchangeable', { response: z.array(couponSchema), summary: '可积分兑换的优惠券' }),
  coupons: op.get('/coupons', { query: memberCouponListQuery, response: paginated(memberCouponSchema), summary: '我的优惠券' }),
  receiveCoupon: op.post('/coupons/receive', { body: memberCouponTemplateSchema, response: memberCouponSchema, summary: '领取优惠券' }),
  exchangeCoupon: op.post('/coupons/exchange', { body: memberCouponTemplateSchema, response: memberCouponSchema, summary: '积分兑换优惠券' }),
  loginLogs: op.get('/login-logs', { query: paginationQuery, response: paginated(memberLoginLogSchema), summary: '我的登录历史' }),
  notifications: op.get('/notifications', { query: memberNotificationListQuery, response: paginated(memberNotificationSchema), summary: '我的通知列表' }),
  unreadCount: op.get('/notifications/unread-count', { response: z.object({ count: z.int() }), summary: '未读通知数' }),
  markAllRead: op.put('/notifications/read-all', { summary: '全部标记已读' }),
  markRead: op.put('/notifications/{id}/read', { params: idParam, summary: '标记通知已读' }),
  inviteSummary: op.get('/invite/summary', { response: memberInviteSummarySchema, summary: '我的邀请汇总' }),
}, { tags: ['MemberSelf'] });
