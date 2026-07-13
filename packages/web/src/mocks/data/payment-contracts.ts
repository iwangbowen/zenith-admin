import { SEED_PAYMENT_DEDUCT_PLANS } from '@zenith/shared';
import type { MemberVipRenewal, PaymentContract, PaymentDeductPlan } from '@zenith/shared';
import { PAYMENT_MOCK_SEED_TIME } from './payment';

const SEED = PAYMENT_MOCK_SEED_TIME;

/** 扣款计划（与 DB seed 同源） */
export const mockDeductPlans: PaymentDeductPlan[] = SEED_PAYMENT_DEDUCT_PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  period: p.period,
  customDays: p.customDays,
  amount: p.amount,
  maxRetries: p.maxRetries,
  status: p.status,
  remark: p.remark,
  contractCount: p.id === 1 ? 1 : 0,
  createdAt: SEED,
  updatedAt: SEED,
}));

/** 签约协议演示数据 */
export const mockPaymentContracts: PaymentContract[] = [
  {
    id: 1,
    contractNo: 'CT17580000000001001',
    channel: 'wechat',
    channelConfigId: 1,
    planId: 1,
    planName: '连续包月 VIP',
    planPeriod: 'monthly',
    planAmount: 1500,
    signerAccount: '13800138000',
    signerName: '张小demo',
    status: 'signed',
    channelContractNo: 'WXCT1758000000001',
    bizType: 'member_renewal',
    bizId: '1',
    nextDeductAt: '2026-08-01 10:00:00',
    lastDeductAt: '2026-07-01 10:00:00',
    failCount: 0,
    totalDeductCount: 3,
    lastOrderNo: 'DED17580000000001001',
    signedAt: '2026-04-01 10:00:00',
    terminatedAt: null,
    remark: '会员自动续费',
    createdAt: '2026-04-01 10:00:00',
    updatedAt: SEED,
  },
  {
    id: 2,
    contractNo: 'CT17580000000002002',
    channel: 'alipay',
    channelConfigId: 2,
    planId: 2,
    planName: '连续包周 VIP',
    planPeriod: 'weekly',
    planAmount: 500,
    signerAccount: 'demo@example.com',
    signerName: '李示例',
    status: 'terminated',
    channelContractNo: 'ALICT1758000000002',
    bizType: 'admin_contract',
    bizId: 'ADM1758000000100',
    nextDeductAt: null,
    lastDeductAt: '2026-06-20 09:30:00',
    failCount: 0,
    totalDeductCount: 5,
    lastOrderNo: 'DED17580000000002005',
    signedAt: '2026-05-15 09:30:00',
    terminatedAt: '2026-06-25 16:00:00',
    remark: '演示解约协议',
    createdAt: '2026-05-15 09:30:00',
    updatedAt: SEED,
  },
];

/** 会员端续费记录（demo 会员） */
export const mockVipRenewals: MemberVipRenewal[] = [
  { id: 3, orderNo: 'DED17580000000001001', contractNo: 'CT17580000000001001', amount: 1500, vipExpireAfter: '2026-08-01 10:00:00', createdAt: '2026-07-01 10:00:00' },
  { id: 2, orderNo: 'DED17580000000001000', contractNo: 'CT17580000000001001', amount: 1500, vipExpireAfter: '2026-07-01 10:00:00', createdAt: '2026-06-01 10:00:00' },
  { id: 1, orderNo: 'DED17580000000000999', contractNo: 'CT17580000000001001', amount: 1500, vipExpireAfter: '2026-06-01 10:00:00', createdAt: '2026-05-01 10:00:00' },
];

export function getNextContractId(): number {
  return mockPaymentContracts.reduce((m, c) => Math.max(m, c.id), 0) + 1;
}

export function getNextPlanId(): number {
  return mockDeductPlans.reduce((m, p) => Math.max(m, p.id), 0) + 1;
}
