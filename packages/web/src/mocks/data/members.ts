import { mockDateTime, mockDateOffset } from '../utils/date';
import { SEED_MEMBER_LEVELS, SEED_MEMBER_TAGS, SEED_COUPONS } from '@zenith/shared';
import type { MemberTagBrief } from '@zenith/shared';

const now = mockDateTime();

export interface MockMember {
  id: number;
  username: string | null;
  phone: string | null;
  email: string | null;
  nickname: string;
  avatar: string | null;
  gender: string | null;
  birthday: string | null;
  status: 'active' | 'inactive' | 'banned';
  levelId: number | null;
  levelName: string | null;
  growthValue: number;
  experience: number;
  registerSource: string;
  registerIp: string | null;
  lastLoginAt: string | null;
  remark: string | null;
  hasPassword: boolean;
  pointBalance: number;
  walletBalance: number;
  tags: MemberTagBrief[];
  createdAt: string;
  updatedAt: string;
  /** 仅 mock 登录校验用 */
  password: string;
}

// Demo 演示用额外字段（不在共享类型中）
const _levelMemberCounts = [86, 32, 12, 3];
const _levelDescriptions = ['注册即可享受', '成长值满 1000', '成长值满 5000', '成长值满 20000'];
export const mockMemberLevels = SEED_MEMBER_LEVELS.map((l, i) => ({
  ...l,
  description: _levelDescriptions[i] ?? null,
  memberCount: _levelMemberCounts[i] ?? 0,
  createdAt: now,
  updatedAt: now,
}));

// 会员标签（与种子对齐 + 会员数）
const _tagMemberCounts = [1, 1, 1];
export const mockMemberTags = SEED_MEMBER_TAGS.map((t, i) => ({
  ...t,
  memberCount: _tagMemberCounts[i] ?? 0,
  createdAt: now,
  updatedAt: now,
}));

const tagBrief = (id: number): MemberTagBrief => {
  const t = SEED_MEMBER_TAGS.find((x) => x.id === id)!;
  return { id: t.id, name: t.name, color: t.color ?? null };
};

export const mockMembers: MockMember[] = [
  { id: 1, username: null, phone: '13800138000', email: 'demo@member.dev', nickname: '演示会员', avatar: null, gender: 'male', birthday: null, status: 'active', levelId: 2, levelName: '银卡会员', growthValue: 1280, experience: 520, registerSource: 'seed', registerIp: '127.0.0.1', lastLoginAt: now, remark: null, hasPassword: true, pointBalance: 1280, walletBalance: 5000, tags: [tagBrief(1)], createdAt: now, updatedAt: now, password: '123456' },
  { id: 2, username: 'alice', phone: '13900139001', email: 'alice@member.dev', nickname: 'Alice', avatar: null, gender: 'female', birthday: null, status: 'active', levelId: 1, levelName: '普通会员', growthValue: 320, experience: 120, registerSource: 'web', registerIp: '127.0.0.1', lastLoginAt: now, remark: null, hasPassword: true, pointBalance: 320, walletBalance: 0, tags: [tagBrief(3)], createdAt: now, updatedAt: now, password: '123456' },
  { id: 3, username: null, phone: '13700137002', email: null, nickname: '老用户', avatar: null, gender: null, birthday: null, status: 'inactive', levelId: 3, levelName: '金卡会员', growthValue: 6200, experience: 1880, registerSource: 'h5', registerIp: '127.0.0.1', lastLoginAt: null, remark: '长期未登录', hasPassword: false, pointBalance: 80, walletBalance: 19900, tags: [tagBrief(2)], createdAt: now, updatedAt: now, password: '' },
];

export const mockMemberPointAccount = { memberId: 1, balance: 1280, frozen: 0, totalEarned: 1500, totalSpent: 220 };

export const mockMemberPointTxs = [
  { id: 1, memberId: 1, type: 'earn', amount: 100, balanceAfter: 100, bizType: 'register', bizId: null, remark: '注册赠送积分', memberName: '演示会员', createdAt: now },
  { id: 2, memberId: 1, type: 'earn', amount: 1200, balanceAfter: 1300, bizType: 'purchase', bizId: 'ORD202601', remark: '消费奖励', memberName: '演示会员', createdAt: now },
  { id: 3, memberId: 1, type: 'redeem', amount: -120, balanceAfter: 1180, bizType: 'redeem', bizId: null, remark: '积分兑换', memberName: '演示会员', createdAt: now },
  { id: 4, memberId: 1, type: 'adjust', amount: 100, balanceAfter: 1280, bizType: 'admin_adjust', bizId: null, remark: '客服补偿', memberName: '演示会员', createdAt: now },
];

export const mockMemberWallet = { memberId: 1, balance: 5000, frozen: 0, totalRecharge: 10000, totalConsume: 5000 };

export const mockMemberWalletTxs = [
  { id: 1, memberId: 1, type: 'recharge', amount: 10000, balanceAfter: 10000, bizType: 'member_recharge', bizId: 'PAY202601', remark: '账户充值', memberName: '演示会员', createdAt: now },
  { id: 2, memberId: 1, type: 'consume', amount: -5000, balanceAfter: 5000, bizType: 'order', bizId: 'ORD202602', remark: '订单支付', memberName: '演示会员', createdAt: now },
];

const _issuedQty = [156, 88];
export const mockCoupons = SEED_COUPONS.map((c, i) => ({
  ...c,
  issuedQuantity: _issuedQty[i] ?? 0,
  createdAt: now,
  updatedAt: now,
}));

export const mockMemberCoupons: import('@zenith/shared').MemberCoupon[] = [
  { id: 1, couponId: 1, memberId: 1, code: 'SEEDCOUPON0001', status: 'unused', receivedAt: now, usedAt: null, expireAt: '2027-01-01 00:00:00', coupon: mockCoupons[0], memberName: '演示会员', createdAt: now },
  { id: 2, couponId: 2, memberId: 1, code: 'SEEDCOUPON0002', status: 'used', receivedAt: now, usedAt: now, expireAt: '2027-01-01 00:00:00', coupon: mockCoupons[1], memberName: '演示会员', createdAt: now },
];

export const mockMemberLoginLogs = [
  { id: 1, memberId: 1, ip: '127.0.0.1', location: '内网IP', browser: 'Chrome', os: 'macOS', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0', status: 'success', message: '登录成功', createdAt: now },
  { id: 2, memberId: 1, ip: '1.2.3.4', location: '广东省深圳市', browser: 'Safari', os: 'iOS', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', status: 'success', message: '登录成功', createdAt: '2026-03-20 09:15:00' },
  { id: 3, memberId: 1, ip: '5.6.7.8', location: '北京市', browser: 'Chrome', os: 'Windows', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0', status: 'fail', message: '账号或密码错误', createdAt: '2026-03-18 22:40:00' },
  { id: 4, memberId: 1, ip: '127.0.0.1', location: '内网IP', browser: 'Firefox', os: 'Ubuntu', userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0)', status: 'success', message: '登录成功', createdAt: '2026-03-15 14:20:00' },
  { id: 5, memberId: 1, ip: '9.10.11.12', location: '上海市', browser: 'Chrome', os: 'Android', userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0', status: 'success', message: '登录成功', createdAt: '2026-03-10 08:05:00' },
];

export const mockMemberRecharges = [
  { id: 1, orderNo: 'PAY20260320001', outTradeNo: 'OUT20260320001', channelTradeNo: '4200001234202603201', memberId: 1, memberNickname: '演示会员', memberPhone: '13800138000', subject: '会员钱包充值', amount: 10000, channel: 'wechat', payMethod: 'wechat_jsapi', status: 'success', paidAmount: 10000, paidAt: '2026-03-20 10:12:30', expiredAt: '2026-03-20 10:42:00', errorMessage: null, createdAt: '2026-03-20 10:12:00' },
  { id: 2, orderNo: 'PAY20260318002', outTradeNo: 'OUT20260318002', channelTradeNo: '2026031822001495', memberId: 2, memberNickname: 'Alice', memberPhone: '13900139001', subject: '会员钱包充值', amount: 5000, channel: 'alipay', payMethod: 'alipay_wap', status: 'success', paidAmount: 5000, paidAt: '2026-03-18 16:05:10', expiredAt: '2026-03-18 16:35:00', errorMessage: null, createdAt: '2026-03-18 16:05:00' },
  { id: 3, orderNo: 'PAY20260317003', outTradeNo: 'OUT20260317003', channelTradeNo: null, memberId: 3, memberNickname: '老用户', memberPhone: '13700137002', subject: '会员钱包充值', amount: 20000, channel: 'wechat', payMethod: 'wechat_native', status: 'closed', paidAmount: null, paidAt: null, expiredAt: '2026-03-17 09:30:00', errorMessage: '订单超时未支付', createdAt: '2026-03-17 09:00:00' },
];

export const mockMemberStatsOverview = {
  totalMembers: 1286,
  todayNewMembers: 18,
  monthNewMembers: 246,
  activeMembers30d: 642,
  totalPoints: 358420,
  totalWalletBalance: 1286500,
  todayCheckins: 312,
  todayCheckinRate: 24.3,
  availableCoupons: 87,
};

function buildTrend(days: number, gen: (i: number) => Record<string, number>) {
  return Array.from({ length: days }, (_, i) => ({
    date: mockDateOffset(i - (days - 1)),
    ...gen(i),
  }));
}

export const mockMemberStatsCharts = {
  registerTrend: buildTrend(30, (i) => ({ count: 6 + ((i * 7 + 3) % 22) })),
  levelDistribution: [
    { name: '普通会员', value: 812 },
    { name: '白银会员', value: 286 },
    { name: '黄金会员', value: 132 },
    { name: '铂金会员', value: 42 },
    { name: '钻石会员', value: 14 },
  ],
  pointTrend: buildTrend(30, (i) => ({
    earned: 1200 + ((i * 137 + 200) % 1800),
    spent: 600 + ((i * 89 + 100) % 1100),
  })),
  checkinTrend: buildTrend(7, (i) => ({ count: 260 + ((i * 53 + 40) % 160) })),
  activitySegments: [
    { name: '7天活跃', value: 486 },
    { name: '30天活跃', value: 312 },
    { name: '90天活跃', value: 187 },
    { name: '沉睡', value: 243 },
    { name: '从未登录', value: 58 },
  ],
  rechargeSegments: [
    { name: '未充值', value: 764 },
    { name: '100元以下', value: 318 },
    { name: '100-500元', value: 152 },
    { name: '500元以上', value: 52 },
  ],
};

// ─── P3：权益 / 通知 / 邀请 ───────────────────────────────────────────────────
export const mockMemberBenefits = {
  growthValue: 1280,
  discount: 98,
  levelId: 2,
  levelName: '银卡会员',
  benefits: ['98 折优惠', '生日积分翻倍'],
  nextLevel: { id: 3, name: '金卡会员', growthThreshold: 5000, discount: 95, growthGap: 3720 },
};

export const mockMemberNotifications: import('@zenith/shared').MemberNotification[] = [
  { id: 1, memberId: 1, type: 'coupon_expiring', title: '优惠券即将过期', content: '你的「全场9折券」将于 3 天后过期，记得及时使用。', readAt: null, createdAt: now },
  { id: 2, memberId: 1, type: 'point_adjust', title: '积分变动通知', content: '管理员增加了你的 100 积分（客服补偿），当前余额 1280。', readAt: null, createdAt: now },
  { id: 3, memberId: 1, type: 'birthday', title: '生日快乐 🎂', content: '生日礼 88 积分已到账，祝你生日快乐！', readAt: now, createdAt: now },
];

export const mockInviteSummary = {
  inviteCode: 'ZENITH88',
  invitedCount: 2,
  totalRewardPoints: 100,
  recentInvitees: [
    { id: 2, nickname: 'Alice', createdAt: now },
    { id: 3, nickname: '老用户', createdAt: now },
  ],
};

