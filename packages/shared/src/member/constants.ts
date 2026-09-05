/** 会员自动续费业务类型（签约协议与扣款单共用） */
export const MEMBER_RENEWAL_BIZ_TYPE = 'member_renewal';

/**
 * 会员前台体验分析（埋点）同意状态的 localStorage key 与版本号。
 * 版本号变更（如隐私政策调整）会使历史存量同意状态失效，强制重新征求同意。
 */
export const MEMBER_ANALYTICS_CONSENT_KEY = 'zenith_member_analytics_consent';

export const MEMBER_ANALYTICS_CONSENT_VERSION = 1;

export const MEMBER_STATUSES = ['active', 'inactive', 'banned'] as const;

export type MemberStatus = typeof MEMBER_STATUSES[number];

export const POINT_TX_TYPES = ['earn', 'redeem', 'expire', 'adjust', 'refund'] as const;

export type PointTxType = typeof POINT_TX_TYPES[number];

export const WALLET_TX_TYPES = ['recharge', 'consume', 'refund', 'adjust'] as const;

export type WalletTxType = typeof WALLET_TX_TYPES[number];

export const COUPON_TYPES = ['amount', 'percent'] as const;

export type CouponType = typeof COUPON_TYPES[number];

export const COUPON_VALID_TYPES = ['fixed', 'relative'] as const;

export type CouponValidType = typeof COUPON_VALID_TYPES[number];

export const COUPON_TEMPLATE_STATUSES = ['draft', 'active', 'paused', 'expired'] as const;

export type CouponTemplateStatus = typeof COUPON_TEMPLATE_STATUSES[number];

export const MEMBER_COUPON_STATUSES = ['unused', 'used', 'expired', 'frozen'] as const;

export type MemberCouponStatus = typeof MEMBER_COUPON_STATUSES[number];

export const MEMBER_REGISTER_SOURCES = ['web', 'h5', 'app', 'admin', 'import'] as const;

export type MemberRegisterSource = typeof MEMBER_REGISTER_SOURCES[number];

export const CHECKIN_MILESTONE_REWARD_TYPES = ['points', 'coupon'] as const;

export type CheckinMilestoneRewardType = typeof CHECKIN_MILESTONE_REWARD_TYPES[number];

export const CHECKIN_MILESTONE_REWARD_TYPE_LABELS: Record<CheckinMilestoneRewardType, string> = {
  points: '积分',
  coupon: '优惠券',
};

/** 会员短信验证码场景 */
export const MEMBER_SMS_SCENES = ['register', 'login', 'reset'] as const;

export type MemberSmsScene = typeof MEMBER_SMS_SCENES[number];

/** 后台充值记录可筛选的支付单状态：不含瞬态的 `unknown`（渠道结果待确认，不作为筛选口径） */
export const MEMBER_RECHARGE_STATUSES = ['pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed'] as const;

export type MemberRechargeStatus = typeof MEMBER_RECHARGE_STATUSES[number];

/** 会员自动续费单期扣款结果 */
export const MEMBER_RENEWAL_DEDUCT_STATUSES = ['success', 'processing', 'failed'] as const;

export type MemberRenewalDeductStatus = typeof MEMBER_RENEWAL_DEDUCT_STATUSES[number];

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: '正常',
  inactive: '未激活',
  banned: '已封禁',
};

export const POINT_TX_TYPE_LABELS: Record<PointTxType, string> = {
  earn: '获得',
  redeem: '兑换消耗',
  expire: '过期',
  adjust: '调整',
  refund: '退还',
};

export const WALLET_TX_TYPE_LABELS: Record<WalletTxType, string> = {
  recharge: '充值',
  consume: '消费',
  refund: '退款',
  adjust: '调整',
};

/**
 * 积分/钱包流水业务类型（bizType）中文标签。
 * bizType 是开放取值（各业务写入自己的标识），此处收录内置业务；
 * 未收录的自定义值由展示侧原样输出。
 */
export const MEMBER_BIZ_TYPE_LABELS: Record<string, string> = {
  register: '注册赠送',
  admin_adjust: '后台调整',
  admin_refund: '后台退款',
  checkin: '每日签到',
  checkin_makeup: '补签',
  checkin_milestone: '签到里程碑',
  birthday: '生日礼',
  invite: '邀请奖励',
  mp_scan_reward: '公众号扫码奖励',
  coupon_exchange: '积分兑换卡券',
  points_exchange: '积分兑换',
  points_inactive_expire: '积分过期清理',
  member_recharge: '会员充值',
  member_recharge_refund: '充值退款冲正',
  member_renewal: '会员续费',
  payment: '支付核销',
  manual_redeem: '手动核销',
  order: '订单',
  cms_interaction: '内容互动奖励',
};

export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  amount: '满减券',
  percent: '折扣券',
};

export const COUPON_TEMPLATE_STATUS_LABELS: Record<CouponTemplateStatus, string> = {
  draft: '草稿',
  active: '生效中',
  paused: '已暂停',
  expired: '已过期',
};

export const MEMBER_COUPON_STATUS_LABELS: Record<MemberCouponStatus, string> = {
  unused: '未使用',
  used: '已使用',
  expired: '已过期',
  frozen: '已冻结',
};
