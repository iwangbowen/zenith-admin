/**
 * 会员中心相关 DTO（注册/登录、会员实体、等级、积分、钱包、优惠券）。
 * 统一通过 lib/openapi-dtos.ts re-export，路由文件从 '../lib/openapi-dtos' 导入。
 */
import { z } from '@hono/zod-openapi';

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
    activeCouponCount: z.number().int(),
    loginLogCount: z.number().int(),
  })
  .openapi('MemberOverview');
