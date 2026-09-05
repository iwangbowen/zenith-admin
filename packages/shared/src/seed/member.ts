import type { Coupon, MemberLevel, MemberTag } from '../member/contracts';
import { SEED_DATE } from './_base';

// ─── 会员等级 ─────────────────────────────────────────────────────────────────

export const SEED_MEMBER_LEVELS: MemberLevel[] = [
  { id: 1, name: '普通会员', level: 1, growthThreshold: 0,     discount: 100, icon: null, benefits: ['基础积分权益'],                                   description: null, sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '银卡会员', level: 2, growthThreshold: 1000,  discount: 98,  icon: null, benefits: ['98 折优惠', '生日积分翻倍'],                        description: null, sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '金卡会员', level: 3, growthThreshold: 5000,  discount: 95,  icon: null, benefits: ['95 折优惠', '生日积分翻倍', '专属客服'],             description: null, sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: '钻石会员', level: 4, growthThreshold: 20000, discount: 90,  icon: null, benefits: ['9 折优惠', '积分翻倍', '专属客服', '优先发货'],      description: null, sort: 4, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 优惠券模板 ──────────────────────────────────────────────────────────────

export const SEED_COUPONS: Coupon[] = [
  { id: 1, name: '新人满100减10', type: 'amount',  faceValue: 1000, threshold: 10000, maxDiscount: null, totalQuantity: 1000, issuedQuantity: 0, perLimit: 1, validType: 'relative', validStart: null, validEnd: null, validDays: 30, exchangePoints: 0,   status: 'active', description: '新人专享满减券',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '全场9折券',    type: 'percent', faceValue: 90,   threshold: 0,     maxDiscount: 5000, totalQuantity: 500,  issuedQuantity: 0, perLimit: 1, validType: 'relative', validStart: null, validEnd: null, validDays: 15, exchangePoints: 200, status: 'active', description: '限时9折，最高减50元；可用 200 积分兑换', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 会员标签（示例）──────────────────────────────────────────────────────────
export const SEED_MEMBER_TAGS: MemberTag[] = [
  { id: 1, name: '高价值', color: 'red',    description: '累计充值较高的重点会员', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '易流失', color: 'orange', description: '长期未登录，需要唤醒运营', sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '新客',   color: 'green',  description: '注册 30 天内的新会员', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 签到里程碑（累计签到天数达标奖励）──────────────────────────────────────────

export interface SeedCheckinMilestone {
  id: number;
  title: string;
  cumulativeDays: number;
  rewardType: 'points' | 'coupon';
  rewardPoints: number;
  couponId: number | null;
  enabled: boolean;
  remark: string | null;
}

export const SEED_CHECKIN_MILESTONES: SeedCheckinMilestone[] = [
  { id: 1, title: '累计签到 7 天',   cumulativeDays: 7,   rewardType: 'points', rewardPoints: 50,  couponId: null, enabled: true, remark: '累计签到满 7 天奖励' },
  { id: 2, title: '累计签到 30 天',  cumulativeDays: 30,  rewardType: 'points', rewardPoints: 300, couponId: null, enabled: true, remark: '累计签到满 30 天奖励' },
  { id: 3, title: '累计签到 100 天', cumulativeDays: 100, rewardType: 'coupon', rewardPoints: 0,   couponId: 2,    enabled: true, remark: '累计签到满 100 天赠送优惠券' },
];
