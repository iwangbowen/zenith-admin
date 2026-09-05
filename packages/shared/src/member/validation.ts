import * as z from 'zod';
import { batchIdsBody, entityStatusSchema } from '../core/api-schemas';
import { partialForUpdate } from '../core/validation';
import { PAYMENT_CASHIER_METHODS, PAYMENT_DEDUCT_METHODS } from '../payment/constants';
import {
  CHECKIN_MILESTONE_REWARD_TYPES,
  COUPON_TEMPLATE_STATUSES,
  COUPON_TYPES,
  COUPON_VALID_TYPES,
  MEMBER_SMS_SCENES,
  MEMBER_STATUSES,
} from './constants';

// ─── 会员前台：钱包充值 / 自动续费 ──────────────────────────────────────────

export const memberWalletRechargeSchema = z.object({
  applicationId: z.number().int().positive(),
  amount: z.number().int().positive('充值金额必须大于 0'),
  payMethod: z.enum(PAYMENT_CASHIER_METHODS),
  memberCouponId: z.number().int().positive().optional(),
});

export type MemberWalletRechargeInput = z.infer<typeof memberWalletRechargeSchema>;

/** 会员端签约自动续费 */
export const memberSignRenewalSchema = z.object({
  applicationId: z.number().int().positive(),
  currency: z.literal('CNY').default('CNY'),
  planId: z.number().int().positive(),
  payMethod: z.enum(PAYMENT_DEDUCT_METHODS).default('wechat_papay'),
});

export type MemberSignRenewalInput = z.infer<typeof memberSignRenewalSchema>;

/** 自动续费接口按支付应用定位协议 */
export const memberRenewalApplicationQuery = z.object({
  applicationId: z.coerce.number().int().positive().meta({ description: '支付应用 ID', example: 1 }),
});

// ─── 会员前台：认证 ───────────────────────────────────────────────────────────
const memberPhoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号码');

/** 会员注册（支持用户名/手机/邮箱多种方式，至少提供一个凭证）*/
export const memberRegisterSchema = z
  .object({
    username: z.string().min(2, '用户名至少2个字符').max(32).optional(),
    phone: memberPhoneSchema.optional(),
    email: z.email('邮箱格式不正确').optional(),
    password: z.string().min(6, '密码至少6个字符').max(64).optional(),
    smsCode: z.string().length(6, '验证码为6位').optional(),
    nickname: z.string().min(1).max(32).optional(),
    /** 邀请码（选填，注册成功后绑定邀请关系并奖励邀请人）*/
    inviteCode: z.string().min(4).max(16).optional(),
  })
  .refine((d) => !!(d.username || d.phone || d.email), { message: '请至少提供用户名、手机号或邮箱' });

/** 会员登录：password（账号+密码）或 sms（手机号+验证码）*/
export const memberLoginSchema = z
  .object({
    loginType: z.enum(['password', 'sms']).default('password'),
    account: z.string().min(1, '请输入登录账号').max(128).optional(),
    password: z.string().min(1).max(64).optional(),
    phone: memberPhoneSchema.optional(),
    smsCode: z.string().length(6).optional(),
  })
  .refine((d) => (d.loginType === 'password' ? !!d.account && !!d.password : !!d.phone && !!d.smsCode), {
    message: '登录参数不完整',
  });

/** 发送短信验证码 */
export const memberSmsCodeSchema = z.object({
  phone: memberPhoneSchema,
  scene: z.enum(MEMBER_SMS_SCENES).default('login'),
});

export const memberRefreshTokenSchema = z.object({ refreshToken: z.string().min(1) });

/** 会员修改资料 */
export const memberUpdateProfileSchema = z.object({
  nickname: z.string().min(1).max(32).optional(),
  avatar: z.string().max(256).nullish(),
  gender: z.string().max(20).nullable().optional(),
  birthday: z.string().max(20).nullable().optional(),
  email: z.email().nullish(),
});

/** 会员修改密码（首次设密时 oldPassword 可空）*/
export const memberChangePasswordSchema = z.object({
  oldPassword: z.string().min(6).max(64).optional(),
  newPassword: z.string().min(6, '密码至少6个字符').max(64),
});

/** 会员忘记密码（手机验证码重置）*/
export const memberResetPasswordSchema = z.object({
  phone: memberPhoneSchema,
  smsCode: z.string().length(6),
  newPassword: z.string().min(6).max(64),
});

/** 自助注销：已设密码的会员验证密码，否则验证短信验证码 */
export const memberDeactivateSchema = z.object({
  password: z.string().max(64).optional(),
  smsCode: z.string().length(6).optional(),
});

export type MemberRegisterInput = z.infer<typeof memberRegisterSchema>;

export type MemberLoginInput = z.infer<typeof memberLoginSchema>;

export type MemberSmsCodeInput = z.infer<typeof memberSmsCodeSchema>;

export type MemberUpdateProfileInput = z.infer<typeof memberUpdateProfileSchema>;

export type MemberChangePasswordInput = z.infer<typeof memberChangePasswordSchema>;

export type MemberResetPasswordInput = z.infer<typeof memberResetPasswordSchema>;

export type MemberDeactivateInput = z.infer<typeof memberDeactivateSchema>;

// ─── 会员前台：优惠券 / 签到 ─────────────────────────────────────────────────

/** 领取 / 积分兑换优惠券共用：只需模板 ID */
export const memberCouponTemplateSchema = z.object({ couponId: z.number().int().positive() });

/** 会员自助补签 */
export const memberMakeupCheckinSchema = z.object({
  date: z.string().meta({ example: '2026-06-18' }),
});

/** 会员评论提交（昵称自动取会员资料，无需蜜罐） */
export const memberSubmitCmsCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(1000),
  /** 回复的父评论 id（0/缺省 = 顶级评论） */
  parentId: z.coerce.number().int().min(0).optional(),
});

export type MemberSubmitCmsCommentInput = z.input<typeof memberSubmitCmsCommentSchema>;

// ─── 后台：会员 ──────────────────────────────────────────────────────────────

const memberStatusSchema = z.enum(MEMBER_STATUSES);

export const createMemberSchema = z.object({
  username: z.string().min(2).max(32).optional(),
  phone: memberPhoneSchema.optional(),
  email: z.email().optional(),
  password: z.string().min(6).max(64).optional(),
  nickname: z.string().min(1).max(32),
  gender: z.string().max(20).nullable().optional(),
  status: memberStatusSchema.optional(),
  levelId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(256).nullable().optional(),
})
  // 与前台注册契约（memberRegisterSchema）同一条业务规则：无任何登录凭证的会员无法登录也无法找回
  .refine((d) => !!(d.username || d.phone || d.email), { message: '用户名、手机号、邮箱至少填写一个' });

/** 后台编辑会员：用户名与密码不可在此修改，手机号 / 邮箱 / 头像允许清空 */
export const updateMemberSchema = z.object({
  nickname: z.string().min(1).max(32).optional(),
  phone: memberPhoneSchema.nullable().optional(),
  email: z.email().nullish(),
  gender: z.string().max(20).nullable().optional(),
  avatar: z.string().max(256).nullish(),
  status: memberStatusSchema.optional(),
  levelId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(256).nullable().optional(),
});

export const setMemberStatusSchema = z.object({ status: memberStatusSchema });

export const adminResetMemberPasswordSchema = z.object({ newPassword: z.string().min(6).max(64) });

export const adjustMemberGrowthSchema = z.object({
  delta: z.number().int().refine((v) => v !== 0, '变动量不能为 0'),
  remark: z.string().max(256).optional(),
});

export const setMemberTagsSchema = z.object({ tagIds: z.array(z.number().int().positive()).max(50) });

export const batchUpdateMemberStatusSchema = z.object({ ids: batchIdsBody.shape.ids, status: memberStatusSchema });

export const batchUpdateMemberLevelSchema = z.object({ ids: batchIdsBody.shape.ids, levelId: z.number().int().positive().nullable() });

export const batchAddMemberTagsSchema = z.object({
  ids: batchIdsBody.shape.ids,
  tagIds: z.array(z.number().int().positive()).min(1).max(50),
});

/** 后台为会员补签：不消耗积分，原因记入签到备注与操作审计 */
export const adminMakeupCheckinSchema = z.object({
  date: z.string().meta({ example: '2026-06-18' }),
  reason: z.string().min(2, '请填写补签原因').max(256).meta({ description: '补签原因（记入签到备注与操作审计）' }),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export type AdjustMemberGrowthInput = z.infer<typeof adjustMemberGrowthSchema>;

// ─── 后台：会员标签 / 等级 ───────────────────────────────────────────────────

export const saveMemberTagSchema = z.object({
  name: z.string().min(1).max(32),
  color: z.string().max(20).nullable().optional(),
  description: z.string().max(256).nullable().optional(),
  sort: z.number().int().optional(),
  status: entityStatusSchema.optional(),
});

export const updateMemberTagSchema = partialForUpdate(saveMemberTagSchema);

export type SaveMemberTagInput = z.infer<typeof saveMemberTagSchema>;

export const createMemberLevelSchema = z.object({
  name: z.string().min(1).max(32),
  level: z.number().int().min(0),
  growthThreshold: z.number().int().min(0),
  discount: z.number().int().min(1).max(100),
  icon: z.string().max(256).nullable().optional(),
  benefits: z.array(z.string()).optional(),
  description: z.string().max(256).nullable().optional(),
  sort: z.number().int().optional(),
  status: entityStatusSchema.optional(),
});

export const updateMemberLevelSchema = partialForUpdate(createMemberLevelSchema);

export type CreateMemberLevelInput = z.infer<typeof createMemberLevelSchema>;

// ─── 后台：积分 / 钱包 ───────────────────────────────────────────────────────

export const adjustMemberPointsSchema = z.object({
  memberId: z.number().int().positive(),
  delta: z.number().int().refine((v) => v !== 0, '变动量不能为 0'),
  remark: z.string().max(256).optional(),
});

export type AdjustMemberPointsInput = z.infer<typeof adjustMemberPointsSchema>;

export const adjustMemberWalletSchema = z.object({
  memberId: z.number().int().positive(),
  amount: z.number().int().refine((v) => v !== 0, '变动金额不能为 0'),
  remark: z.string().max(256).optional(),
});

export type AdjustMemberWalletInput = z.infer<typeof adjustMemberWalletSchema>;

export const refundMemberWalletSchema = z.object({
  memberId: z.number().int().positive(),
  amount: z.number().int().positive('退款金额必须大于 0'),
  /** 关联业务单号（如支付/退款单），供审计追溯 */
  bizId: z.string().max(64).optional(),
  remark: z.string().min(1, '请填写退款原因').max(256),
});

export type RefundMemberWalletInput = z.infer<typeof refundMemberWalletSchema>;

// ─── 后台：优惠券 ────────────────────────────────────────────────────────────

export const createCouponSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(COUPON_TYPES),
  faceValue: z.number().int().min(1),
  threshold: z.number().int().min(0).optional(),
  maxDiscount: z.number().int().min(0).nullable().optional(),
  totalQuantity: z.number().int().min(0).optional(),
  perLimit: z.number().int().min(0).optional(),
  validType: z.enum(COUPON_VALID_TYPES),
  validStart: z.string().optional(),
  validEnd: z.string().optional(),
  validDays: z.number().int().min(1).nullable().optional(),
  exchangePoints: z.number().int().min(0).optional(),
  status: z.enum(COUPON_TEMPLATE_STATUSES).optional(),
  description: z.string().max(256).nullable().optional(),
});

export const updateCouponSchema = partialForUpdate(createCouponSchema);

export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const issueCouponSchema = z.object({ memberId: z.number().int().positive() });

export const redeemCouponSchema = z.object({
  code: z.string().min(4).max(32),
  remark: z.string().max(128).optional(),
});

export type RedeemCouponInput = z.infer<typeof redeemCouponSchema>;

// ─── 后台：签到规则 / 里程碑 / 设置 ──────────────────────────────────────────

export const createCheckinRuleSchema = z.object({
  dayNumber: z.number().int().min(1),
  points: z.number().int().min(0).default(0),
  experience: z.number().int().min(0).default(0),
  remark: z.string().max(256).nullable().optional(),
});

export const updateCheckinRuleSchema = partialForUpdate(createCheckinRuleSchema);

export type CreateCheckinRuleInput = z.input<typeof createCheckinRuleSchema>;

export const createCheckinMilestoneSchema = z.object({
  title: z.string().min(1).max(64),
  cumulativeDays: z.number().int().min(1),
  rewardType: z.enum(CHECKIN_MILESTONE_REWARD_TYPES),
  rewardPoints: z.number().int().min(0).default(0),
  couponId: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().default(true),
  remark: z.string().max(256).nullable().optional(),
});

export const updateCheckinMilestoneSchema = partialForUpdate(createCheckinMilestoneSchema);

export type CreateCheckinMilestoneInput = z.input<typeof createCheckinMilestoneSchema>;

export const updateCheckinSettingsSchema = z.object({
  makeupEnabled: z.boolean().optional(),
  makeupCostPoints: z.number().int().min(0).optional(),
  makeupMaxDays: z.number().int().min(1).max(366).optional(),
});

export type UpdateCheckinSettingsInput = z.infer<typeof updateCheckinSettingsSchema>;
