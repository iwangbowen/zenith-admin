/**
 * 会员中心相关 DTO（注册/登录、会员实体、等级、积分、钱包、优惠券）。
 * 统一通过 lib/openapi-dtos.ts re-export，路由文件从 '../lib/openapi-dtos' 导入。
 */
import { z } from '@hono/zod-openapi';
import { MemberLoginLogDTO } from './logs';

// ─── 会员实体 ─────────────────────────────────────────────────────────────────
export const MemberDTO = z
  .object({
    id: z.number().int(),
    username: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    nickname: z.string(),
    avatar: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    birthday: z.string().nullable().optional(),
    status: z.enum(['active', 'inactive', 'banned']),
    levelId: z.number().int().nullable().optional(),
    levelName: z.string().nullable().optional(),
    growthValue: z.number().int(),
    experience: z.number().int(),
    registerSource: z.string(),
    registerIp: z.string().nullable().optional(),
    lastLoginAt: z.string().nullable().optional(),
    lastLoginIp: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    hasPassword: z.boolean().optional(),
    pointBalance: z.number().int().optional(),
    walletBalance: z.number().int().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Member');

export const MemberOptionDTO = z
  .object({
    id: z.number().int(),
    nickname: z.string(),
    phone: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
    levelName: z.string().nullable().optional(),
  })
  .openapi('MemberOption');

export const MemberTokenDTO = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
  })
  .openapi('MemberToken');

export const MemberLoginResultDTO = z
  .object({
    member: MemberDTO,
    token: MemberTokenDTO,
  })
  .openapi('MemberLoginResult');

export const MemberRefreshResultDTO = z
  .object({ accessToken: z.string() })
  .openapi('MemberRefreshResult');

export const MemberSmsCodeResultDTO = z
  .object({
    sent: z.boolean(),
    /** 非生产环境回传，便于联调 */
    devCode: z.string().optional(),
  })
  .openapi('MemberSmsCodeResult');

// ─── 会员等级 ─────────────────────────────────────────────────────────────────
export const MemberLevelDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    level: z.number().int(),
    growthThreshold: z.number().int(),
    discount: z.number().int(),
    icon: z.string().nullable().optional(),
    benefits: z.array(z.string()),
    description: z.string().nullable().optional(),
    sort: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    memberCount: z.number().int().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MemberLevel');

// ─── 积分 ─────────────────────────────────────────────────────────────────────
export const MemberPointAccountDTO = z
  .object({
    memberId: z.number().int(),
    balance: z.number().int(),
    frozen: z.number().int(),
    totalEarned: z.number().int(),
    totalSpent: z.number().int(),
  })
  .openapi('MemberPointAccount');

export const MemberPointTransactionDTO = z
  .object({
    id: z.number().int(),
    memberId: z.number().int(),
    type: z.enum(['earn', 'redeem', 'expire', 'adjust', 'refund']),
    amount: z.number().int(),
    balanceAfter: z.number().int(),
    bizType: z.string().nullable().optional(),
    bizId: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    memberName: z.string().optional(),
    createdAt: z.string(),
  })
  .openapi('MemberPointTransaction');

// ─── 钱包 ─────────────────────────────────────────────────────────────────────
export const MemberWalletDTO = z
  .object({
    memberId: z.number().int(),
    balance: z.number().int(),
    frozen: z.number().int(),
    totalRecharge: z.number().int(),
    totalConsume: z.number().int(),
  })
  .openapi('MemberWallet');

export const MemberWalletTransactionDTO = z
  .object({
    id: z.number().int(),
    memberId: z.number().int(),
    type: z.enum(['recharge', 'consume', 'refund', 'adjust']),
    amount: z.number().int(),
    balanceAfter: z.number().int(),
    bizType: z.string().nullable().optional(),
    bizId: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    memberName: z.string().optional(),
    createdAt: z.string(),
  })
  .openapi('MemberWalletTransaction');

export const MemberWalletRechargeResultDTO = z
  .object({
    orderNo: z.string(),
    payMethod: z.string(),
    channel: z.string(),
    codeUrl: z.string().optional(),
    payUrl: z.string().optional(),
    formHtml: z.string().optional(),
    expiredAt: z.string().optional(),
  })
  .openapi('MemberWalletRechargeResult');

// ─── 优惠券 ───────────────────────────────────────────────────────────────────
export const CouponDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    type: z.enum(['amount', 'percent']),
    faceValue: z.number().int(),
    threshold: z.number().int(),
    maxDiscount: z.number().int().nullable().optional(),
    totalQuantity: z.number().int(),
    issuedQuantity: z.number().int(),
    perLimit: z.number().int(),
    validType: z.enum(['fixed', 'relative']),
    validStart: z.string().nullable().optional(),
    validEnd: z.string().nullable().optional(),
    validDays: z.number().int().nullable().optional(),
    status: z.enum(['draft', 'active', 'paused', 'expired']),
    description: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Coupon');

export const MemberCouponDTO = z
  .object({
    id: z.number().int(),
    couponId: z.number().int(),
    memberId: z.number().int(),
    code: z.string(),
    status: z.enum(['unused', 'used', 'expired', 'frozen']),
    receivedAt: z.string(),
    usedAt: z.string().nullable().optional(),
    expireAt: z.string().nullable().optional(),
    coupon: CouponDTO.optional(),
    memberName: z.string().optional(),
    createdAt: z.string(),
  })
  .openapi('MemberCoupon');

// ─── 会员概览（后台详情侧滑）─────────────────────────────────────────────────
export const MemberOverviewDTO = z
  .object({
    member: MemberDTO,
    points: MemberPointAccountDTO,
    wallet: MemberWalletDTO,
    recentPointTxs: z.array(MemberPointTransactionDTO),
    recentWalletTxs: z.array(MemberWalletTransactionDTO),
    recentLoginLogs: z.array(MemberLoginLogDTO),
    activeCouponCount: z.number().int(),
    loginLogCount: z.number().int(),
  })
  .openapi('MemberOverview');

export const MemberRechargeDTO = z
  .object({
    id: z.number().int(),
    orderNo: z.string(),
    outTradeNo: z.string(),
    channelTradeNo: z.string().nullable(),
    memberId: z.number().int().nullable(),
    memberNickname: z.string().nullable(),
    memberPhone: z.string().nullable(),
    subject: z.string(),
    amount: z.number().int(),
    channel: z.enum(['wechat', 'alipay', 'unionpay']),
    payMethod: z.string(),
    status: z.enum(['pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed']),
    paidAmount: z.number().int().nullable(),
    paidAt: z.string().nullable(),
    expiredAt: z.string().nullable(),
    errorMessage: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('MemberRecharge');

export const MemberStatsOverviewDTO = z
  .object({
    totalMembers: z.number().int(),
    todayNewMembers: z.number().int(),
    monthNewMembers: z.number().int(),
    activeMembers30d: z.number().int(),
    totalPoints: z.number().int(),
    totalWalletBalance: z.number().int(),
    todayCheckins: z.number().int(),
    todayCheckinRate: z.number(),
    availableCoupons: z.number().int(),
  })
  .openapi('MemberStatsOverview');

export const MemberStatsChartsDTO = z
  .object({
    registerTrend: z.array(z.object({ date: z.string(), count: z.number().int() })),
    levelDistribution: z.array(z.object({ name: z.string(), value: z.number().int() })),
    pointTrend: z.array(z.object({ date: z.string(), earned: z.number().int(), spent: z.number().int() })),
    checkinTrend: z.array(z.object({ date: z.string(), count: z.number().int() })),
  })
  .openapi('MemberStatsCharts');

export const CheckinRuleDTO = z
  .object({
    id: z.number().int(),
    dayNumber: z.number().int(),
    points: z.number().int(),
    experience: z.number().int(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CheckinRule');

export const MemberCheckinDTO = z
  .object({
    id: z.number().int(),
    memberId: z.number().int(),
    memberNickname: z.string().nullable().optional(),
    checkinDate: z.string(),
    consecutiveDays: z.number().int(),
    pointsAwarded: z.number().int(),
    experienceAwarded: z.number().int(),
    isMakeup: z.boolean().optional(),
    createdAt: z.string(),
  })
  .openapi('MemberCheckin');

export const MemberCheckinStatusDTO = z
  .object({
    checkedToday: z.boolean(),
    consecutiveDays: z.number().int(),
    totalDays: z.number().int(),
    todayPoints: z.number().int(),
    todayExperience: z.number().int(),
    nextDayPoints: z.number().int(),
    nextDayExperience: z.number().int(),
    thisMonthDates: z.array(z.string()),
  })
  .openapi('MemberCheckinStatus');

export const CheckinSettingsDTO = z
  .object({
    makeupEnabled: z.boolean(),
    makeupCostPoints: z.number().int(),
    makeupMaxDays: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi('CheckinSettings');

export const CheckinMilestoneDTO = z
  .object({
    id: z.number().int(),
    title: z.string(),
    cumulativeDays: z.number().int(),
    rewardType: z.enum(['points', 'coupon']),
    rewardPoints: z.number().int(),
    couponId: z.number().int().nullable().optional(),
    couponName: z.string().nullable().optional(),
    enabled: z.boolean(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CheckinMilestone');

export const MemberMilestoneStatusDTO = z
  .object({
    totalDays: z.number().int(),
    milestones: z.array(
      z.object({
        id: z.number().int(),
        title: z.string(),
        cumulativeDays: z.number().int(),
        rewardType: z.enum(['points', 'coupon']),
        rewardPoints: z.number().int(),
        couponName: z.string().nullable().optional(),
        achieved: z.boolean(),
        achievedAt: z.string().nullable().optional(),
      }),
    ),
  })
  .openapi('MemberMilestoneStatus');

export const MakeupCheckinResultDTO = z
  .object({
    checkinDate: z.string(),
    pointsAwarded: z.number().int(),
    experienceAwarded: z.number().int(),
    costPoints: z.number().int(),
    consecutiveDays: z.number().int(),
  })
  .openapi('MakeupCheckinResult');
