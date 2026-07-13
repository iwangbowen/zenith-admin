import { http } from 'msw';
import { mockDeductPlans, mockPaymentContracts, mockVipRenewals, getNextContractId, getNextPlanId } from '@/mocks/data/payment-contracts';
import { mockDateTime } from '@/mocks/utils/date';
import { ok, notFound, badRequest, paginate } from '@/mocks/utils/handlers';
import { PAYMENT_METHOD_CHANNEL } from '@zenith/shared';
import type { MemberVipRenewal, PaymentContract, PaymentDeductMethod, PaymentDeductPeriod, PaymentDeductPlan } from '@zenith/shared';
import dayjs from 'dayjs';

const DEMO_MEMBER_BIZ = { bizType: 'member_renewal', bizId: '1' };

function advance(period: PaymentDeductPeriod, customDays: number | null | undefined, base = new Date()): string {
  const d = dayjs(base);
  const next = period === 'daily' ? d.add(1, 'day') : period === 'weekly' ? d.add(1, 'week') : period === 'monthly' ? d.add(1, 'month') : d.add(Math.max(1, customDays ?? 1), 'day');
  return next.format('YYYY-MM-DD HH:mm:ss');
}

function planOf(contract: PaymentContract): PaymentDeductPlan | undefined {
  return mockDeductPlans.find((p) => p.id === contract.planId);
}

/** 模拟执行一期扣款（沙箱永远成功）：推进排期 + 追加会员续费记录 */
function simulateDeduct(contract: PaymentContract): { orderNo: string; deductStatus: 'success' } {
  const plan = planOf(contract);
  const orderNo = `DED${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
  const now = mockDateTime();
  contract.lastOrderNo = orderNo;
  contract.lastDeductAt = now;
  contract.failCount = 0;
  contract.totalDeductCount += 1;
  contract.nextDeductAt = advance(plan?.period ?? 'monthly', plan?.customDays);
  contract.updatedAt = now;
  if (contract.bizType === DEMO_MEMBER_BIZ.bizType) {
    const vipExpireAfter = contract.nextDeductAt;
    mockVipRenewals.unshift({
      id: mockVipRenewals.reduce((m, r) => Math.max(m, r.id), 0) + 1,
      orderNo,
      contractNo: contract.contractNo,
      amount: plan?.amount ?? 0,
      vipExpireAfter,
      createdAt: now,
    } satisfies MemberVipRenewal);
  }
  return { orderNo, deductStatus: 'success' };
}

// ─── 管理端：扣款计划 ─────────────────────────────────────────────────────────

const planHandlers = [
  http.get('/api/payment/deduct-plans/all', () => ok(mockDeductPlans.filter((p) => p.status === 'enabled'))),
  http.get('/api/payment/deduct-plans', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = mockDeductPlans
      .filter((p) => (!keyword || p.name.includes(keyword)) && (!status || p.status === status))
      .map((p) => ({ ...p, contractCount: mockPaymentContracts.filter((c) => c.planId === p.id).length }));
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id), url));
  }),
  http.post('/api/payment/deduct-plans', async ({ request }) => {
    const b = (await request.json()) as Partial<PaymentDeductPlan>;
    const now = mockDateTime();
    const item: PaymentDeductPlan = {
      id: getNextPlanId(),
      name: b.name ?? '',
      period: (b.period as PaymentDeductPeriod) ?? 'monthly',
      customDays: b.period === 'custom' ? (b.customDays ?? null) : null,
      amount: b.amount ?? 0,
      maxRetries: b.maxRetries ?? 3,
      status: b.status ?? 'enabled',
      remark: b.remark ?? null,
      contractCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockDeductPlans.push(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/payment/deduct-plans/:id', async ({ params, request }) => {
    const p = mockDeductPlans.find((x) => x.id === Number(params.id));
    if (!p) return notFound('扣款计划不存在');
    const b = (await request.json()) as Partial<PaymentDeductPlan>;
    Object.assign(p, b, { updatedAt: mockDateTime() });
    if (p.period !== 'custom') p.customDays = null;
    return ok(p, '更新成功');
  }),
  http.delete('/api/payment/deduct-plans/:id', ({ params }) => {
    const id = Number(params.id);
    const i = mockDeductPlans.findIndex((x) => x.id === id);
    if (i === -1) return notFound('扣款计划不存在');
    const refs = mockPaymentContracts.filter((c) => c.planId === id).length;
    if (refs > 0) return badRequest(`该计划已被 ${refs} 份签约协议引用，无法删除`);
    mockDeductPlans.splice(i, 1);
    return ok(null, '删除成功');
  }),
];

// ─── 管理端：签约协议 ─────────────────────────────────────────────────────────

const contractHandlers = [
  http.get('/api/payment/contracts', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    const filtered = mockPaymentContracts.filter((c) =>
      (!keyword || c.contractNo.includes(keyword) || c.signerAccount.includes(keyword) || c.bizId.includes(keyword)) &&
      (!status || c.status === status) &&
      (!channel || c.channel === channel),
    );
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id), url));
  }),
  http.get('/api/payment/contracts/:id', ({ params }) => {
    const c = mockPaymentContracts.find((x) => x.id === Number(params.id));
    return c ? ok(c) : notFound('签约协议不存在');
  }),
  http.post('/api/payment/contracts', async ({ request }) => {
    const b = (await request.json()) as { planId: number; payMethod: PaymentDeductMethod; signerAccount: string; signerName?: string; remark?: string; firstDeductNow?: boolean };
    const plan = mockDeductPlans.find((p) => p.id === b.planId);
    if (!plan) return notFound('扣款计划不存在');
    if (plan.status !== 'enabled') return badRequest('扣款计划已停用');
    const now = mockDateTime();
    const contract: PaymentContract = {
      id: getNextContractId(),
      contractNo: `CT${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`,
      channel: PAYMENT_METHOD_CHANNEL[b.payMethod],
      channelConfigId: null,
      planId: plan.id,
      planName: plan.name,
      planPeriod: plan.period,
      planAmount: plan.amount,
      signerAccount: b.signerAccount,
      signerName: b.signerName ?? null,
      status: 'signed',
      channelContractNo: `${b.payMethod === 'wechat_papay' ? 'WXCT' : 'ALICT'}${Date.now()}`,
      bizType: 'admin_contract',
      bizId: `ADM${Date.now()}`,
      nextDeductAt: advance(plan.period, plan.customDays),
      lastDeductAt: null,
      failCount: 0,
      totalDeductCount: 0,
      lastOrderNo: null,
      signedAt: now,
      terminatedAt: null,
      remark: b.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockPaymentContracts.push(contract);
    let firstDeduct: { orderNo: string; deductStatus: 'success' } | null = null;
    if (b.firstDeductNow !== false) firstDeduct = simulateDeduct(contract);
    return ok({ contract, firstDeduct }, '签约完成');
  }),
  http.post('/api/payment/contracts/:id/terminate', ({ params }) => {
    const c = mockPaymentContracts.find((x) => x.id === Number(params.id));
    if (!c) return notFound('签约协议不存在');
    if (c.status === 'terminated') return badRequest('协议已解约');
    c.status = 'terminated';
    c.terminatedAt = mockDateTime();
    c.nextDeductAt = null;
    c.updatedAt = mockDateTime();
    return ok(c, '解约成功');
  }),
  http.post('/api/payment/contracts/:id/pause', ({ params }) => {
    const c = mockPaymentContracts.find((x) => x.id === Number(params.id));
    if (!c) return notFound('签约协议不存在');
    if (c.status !== 'signed') return badRequest('仅已签约协议可暂停');
    c.status = 'paused';
    c.updatedAt = mockDateTime();
    return ok(c, '已暂停');
  }),
  http.post('/api/payment/contracts/:id/resume', ({ params }) => {
    const c = mockPaymentContracts.find((x) => x.id === Number(params.id));
    if (!c) return notFound('签约协议不存在');
    if (c.status !== 'paused') return badRequest('仅已暂停协议可恢复');
    c.status = 'signed';
    c.failCount = 0;
    c.nextDeductAt = mockDateTime();
    c.updatedAt = mockDateTime();
    return ok(c, '已恢复');
  }),
  http.post('/api/payment/contracts/:id/deduct', ({ params }) => {
    const c = mockPaymentContracts.find((x) => x.id === Number(params.id));
    if (!c) return notFound('签约协议不存在');
    if (c.status !== 'signed') return badRequest('仅已签约协议可执行扣款');
    const result = simulateDeduct(c);
    return ok({ ...result, contract: c }, '扣款执行完成');
  }),
];

// ─── 会员端：自动续费 ─────────────────────────────────────────────────────────

function findMemberContract(): PaymentContract | undefined {
  return mockPaymentContracts.find(
    (c) => c.bizType === DEMO_MEMBER_BIZ.bizType && c.bizId === DEMO_MEMBER_BIZ.bizId && c.status !== 'terminated',
  );
}

function memberVipExpireAt(): string | null {
  return mockVipRenewals.length > 0 ? mockVipRenewals[0].vipExpireAfter : null;
}

const memberRenewalHandlers = [
  http.get('/api/member/renewal/plans', () =>
    ok(mockDeductPlans.filter((p) => p.status === 'enabled').map((p) => ({ id: p.id, name: p.name, period: p.period, customDays: p.customDays ?? null, amount: p.amount, remark: p.remark ?? null }))),
  ),
  http.get('/api/member/renewal', () =>
    ok({ vipExpireAt: memberVipExpireAt(), contract: findMemberContract() ?? null, renewals: mockVipRenewals.slice(0, 20) }),
  ),
  http.post('/api/member/renewal/sign', async ({ request }) => {
    const b = (await request.json()) as { planId: number; payMethod?: PaymentDeductMethod };
    if (findMemberContract()) return badRequest('该业务已存在生效中的签约协议');
    const plan = mockDeductPlans.find((p) => p.id === b.planId);
    if (!plan) return notFound('扣款计划不存在');
    const payMethod = b.payMethod ?? 'wechat_papay';
    const now = mockDateTime();
    const contract: PaymentContract = {
      id: getNextContractId(),
      contractNo: `CT${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`,
      channel: PAYMENT_METHOD_CHANNEL[payMethod],
      channelConfigId: null,
      planId: plan.id,
      planName: plan.name,
      planPeriod: plan.period,
      planAmount: plan.amount,
      signerAccount: '13800138000',
      signerName: '演示会员',
      status: 'signed',
      channelContractNo: `${payMethod === 'wechat_papay' ? 'WXCT' : 'ALICT'}${Date.now()}`,
      bizType: DEMO_MEMBER_BIZ.bizType,
      bizId: DEMO_MEMBER_BIZ.bizId,
      nextDeductAt: advance(plan.period, plan.customDays),
      lastDeductAt: null,
      failCount: 0,
      totalDeductCount: 0,
      lastOrderNo: null,
      signedAt: now,
      terminatedAt: null,
      remark: '会员自动续费',
      createdAt: now,
      updatedAt: now,
    };
    mockPaymentContracts.push(contract);
    const firstDeduct = simulateDeduct(contract);
    return ok({ contract, firstDeduct }, '签约完成');
  }),
  http.post('/api/member/renewal/terminate', () => {
    const c = findMemberContract();
    if (!c) return notFound('未开通自动续费');
    c.status = 'terminated';
    c.terminatedAt = mockDateTime();
    c.nextDeductAt = null;
    return ok(null, '已关闭自动续费');
  }),
  http.post('/api/member/renewal/deduct', () => {
    const c = findMemberContract();
    if (!c) return notFound('未开通自动续费');
    if (c.status !== 'signed') return badRequest('协议未生效，无法扣款');
    return ok(simulateDeduct(c), '扣款执行完成');
  }),
];

export const paymentContractHandlers = [...planHandlers, ...contractHandlers, ...memberRenewalHandlers];
