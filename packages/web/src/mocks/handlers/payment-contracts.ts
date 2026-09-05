import { memberRenewalContract } from '@zenith/shared/member';
import { mock } from '@/mocks/utils/contract';
import { mockDeductPlans, mockPaymentContracts, mockVipRenewals, getNextContractId, getNextPlanId } from '@/mocks/data/payment-contracts';
import { mockDateTime } from '@/mocks/utils/date';
import { notFound, badRequest } from '@/mocks/utils/handlers';
import { PAYMENT_METHOD_CHANNEL, paymentDeductPlanContract, paymentSigningContract } from '@zenith/shared/payment';
import type { MemberVipRenewal } from '@zenith/shared/member';
import type { PaymentContract, PaymentContractDeductOutcome, PaymentDeductMethod, PaymentDeductPeriod, PaymentDeductPlan } from '@zenith/shared/payment';
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

function contractScope(applicationId: number, payMethod: PaymentDeductMethod) {
  if ((applicationId === 1 || applicationId === 2) && payMethod === 'wechat_papay') return { appId: applicationId, channelConfigId: 1 };
  if (applicationId === 3 && payMethod === 'alipay_cycle') return { appId: applicationId, channelConfigId: 2 };
  return null;
}

/** 模拟执行一期扣款（沙箱永远成功）：推进排期 + 追加会员续费记录 */
function simulateDeduct(contract: PaymentContract): PaymentContractDeductOutcome & { orderNo: string; deductStatus: 'success' } {
  const plan = planOf(contract);
  const orderNo = `DED${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
  const now = mockDateTime();
  contract.lastOrderNo = orderNo;
  contract.lastDeductAt = now;
  contract.failCount = 0;
  contract.totalDeductCount += 1;
  contract.version += 1;
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

/** 协议按支付应用隔离：applicationId 已由契约 query 校验为正整数 */
function findScopedContract(id: number, applicationId: number): PaymentContract | undefined {
  return mockPaymentContracts.find((x) => x.id === id && x.appId === applicationId);
}

// ─── 管理端：扣款计划 ─────────────────────────────────────────────────────────

const planHandlers = [
  mock(paymentDeductPlanContract.deductPlansAll, ({ ok }) => ok(mockDeductPlans.filter((p) => p.status === 'enabled'))),
  mock(paymentDeductPlanContract.deductPlans, ({ query, ok, paginate }) => {
    const filtered = mockDeductPlans
      .filter((p) => (!query.keyword || p.name.includes(query.keyword)) && (!query.status || p.status === query.status))
      .map((p) => ({ ...p, contractCount: mockPaymentContracts.filter((c) => c.planId === p.id).length }));
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),
  mock(paymentDeductPlanContract.createDeductPlan, ({ body, ok }) => {
    const now = mockDateTime();
    const item: PaymentDeductPlan = {
      id: getNextPlanId(),
      name: body.name,
      period: body.period,
      customDays: body.period === 'custom' ? (body.customDays ?? null) : null,
      amount: body.amount,
      maxRetries: body.maxRetries,
      status: body.status,
      remark: body.remark ?? null,
      contractCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockDeductPlans.push(item);
    return ok(item, '创建成功');
  }),
  mock(paymentDeductPlanContract.updateDeductPlan, ({ params, body, ok }) => {
    const p = mockDeductPlans.find((x) => x.id === params.id);
    if (!p) return notFound('扣款计划不存在');
    Object.assign(p, body, { updatedAt: mockDateTime() });
    if (p.period !== 'custom') p.customDays = null;
    return ok(p, '更新成功');
  }),
  mock(paymentDeductPlanContract.removeDeductPlan, ({ params, ok }) => {
    const i = mockDeductPlans.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('扣款计划不存在');
    const refs = mockPaymentContracts.filter((c) => c.planId === params.id).length;
    if (refs > 0) return badRequest(`该计划已被 ${refs} 份签约协议引用，无法删除`);
    mockDeductPlans.splice(i, 1);
    return ok(null, '删除成功');
  }),
];

// ─── 管理端：签约协议 ─────────────────────────────────────────────────────────

const contractHandlers = [
  mock(paymentSigningContract.contracts, ({ query, ok, paginate }) => {
    const filtered = mockPaymentContracts.filter((c) => c.appId === query.applicationId &&
      (!query.keyword || c.contractNo.includes(query.keyword) || c.signerAccount.includes(query.keyword) || c.bizId.includes(query.keyword)) &&
      (!query.status || c.status === query.status) &&
      (!query.channel || c.channel === query.channel) &&
      (!query.planId || c.planId === query.planId) &&
      (!query.bizType || c.bizType === query.bizType),
    );
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),
  mock(paymentSigningContract.contractDetail, ({ params, query, ok }) => {
    const c = findScopedContract(params.id, query.applicationId);
    return c ? ok(c) : notFound('签约协议不存在');
  }),
  mock(paymentSigningContract.createContract, ({ body, ok }) => {
    const plan = mockDeductPlans.find((p) => p.id === body.planId);
    if (!plan) return notFound('扣款计划不存在');
    if (plan.status !== 'enabled') return badRequest('扣款计划已停用');
    const scope = contractScope(body.applicationId, body.payMethod);
    if (!scope) return badRequest('支付应用未绑定所选代扣方式对应的商户配置');
    const now = mockDateTime();
    const contract: PaymentContract = {
      id: getNextContractId(),
      contractNo: `CT${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`,
      channel: PAYMENT_METHOD_CHANNEL[body.payMethod],
      channelConfigId: scope.channelConfigId,
      appId: scope.appId,
      currency: body.currency,
      planId: plan.id,
      planName: plan.name,
      planPeriod: plan.period,
      planAmount: plan.amount,
      signerAccount: body.signerAccount,
      signerName: body.signerName ?? null,
      status: 'signed',
      unknownOperation: null,
      version: 0,
      errorMessage: null,
      channelContractNo: `${body.payMethod === 'wechat_papay' ? 'WXCT' : 'ALICT'}${Date.now()}`,
      bizType: 'admin_contract',
      bizId: `ADM${Date.now()}`,
      nextDeductAt: advance(plan.period, plan.customDays),
      lastDeductAt: null,
      failCount: 0,
      totalDeductCount: 0,
      lastOrderNo: null,
      signedAt: now,
      terminatedAt: null,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockPaymentContracts.push(contract);
    const firstDeduct = body.firstDeductNow ? simulateDeduct(contract) : null;
    return ok({ contract, firstDeduct }, '签约完成');
  }),
  mock(paymentSigningContract.terminateContract, ({ params, query, ok }) => {
    const c = findScopedContract(params.id, query.applicationId);
    if (!c) return notFound('签约协议不存在');
    if (c.status !== 'signed' && c.status !== 'paused') return badRequest('只有已签约或已暂停协议可解约');
    c.status = 'terminated';
    c.unknownOperation = null;
    c.version += 1;
    c.terminatedAt = mockDateTime();
    c.nextDeductAt = null;
    c.updatedAt = mockDateTime();
    return ok(c, '解约成功');
  }),
  mock(paymentSigningContract.pauseContract, ({ params, query, ok }) => {
    const c = findScopedContract(params.id, query.applicationId);
    if (!c) return notFound('签约协议不存在');
    if (c.status !== 'signed') return badRequest('仅已签约协议可暂停');
    c.status = 'paused';
    c.version += 1;
    c.updatedAt = mockDateTime();
    return ok(c, '已暂停');
  }),
  mock(paymentSigningContract.resumeContract, ({ params, query, ok }) => {
    const c = findScopedContract(params.id, query.applicationId);
    if (!c) return notFound('签约协议不存在');
    if (c.status !== 'paused') return badRequest('仅已暂停协议可恢复');
    c.status = 'signed';
    c.version += 1;
    c.failCount = 0;
    c.nextDeductAt = mockDateTime();
    c.updatedAt = mockDateTime();
    return ok(c, '已恢复');
  }),
  mock(paymentSigningContract.deductContract, ({ params, query, ok }) => {
    const c = findScopedContract(params.id, query.applicationId);
    if (!c) return notFound('签约协议不存在');
    if (c.status !== 'signed') return badRequest('仅已签约协议可执行扣款');
    const result = simulateDeduct(c);
    return ok({ ...result, contract: c }, '扣款执行完成');
  }),
  mock(paymentSigningContract.recoverContract, ({ params, query, ok }) => {
    const c = findScopedContract(params.id, query.applicationId);
    if (!c) return notFound('签约协议不存在');
    if (c.status !== 'pending' && c.status !== 'unknown') return ok(c, '查询完成');
    const operation = c.unknownOperation ?? 'sign';
    c.status = operation === 'terminate' ? 'terminated' : 'signed';
    c.unknownOperation = null;
    c.errorMessage = null;
    c.version += 1;
    c.updatedAt = mockDateTime();
    if (c.status === 'signed') {
      c.signedAt ??= c.updatedAt;
      c.nextDeductAt ??= advance(c.planPeriod ?? 'monthly', null);
    } else {
      c.terminatedAt = c.updatedAt;
      c.nextDeductAt = null;
    }
    return ok(c, '查询完成');
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
  mock(memberRenewalContract.plans, ({ ok }) =>
    ok(mockDeductPlans.filter((p) => p.status === 'enabled').map((p) => ({ id: p.id, name: p.name, period: p.period, customDays: p.customDays ?? null, amount: p.amount, remark: p.remark ?? null })))),
  mock(memberRenewalContract.info, ({ ok }) =>
    ok({ vipExpireAt: memberVipExpireAt(), contract: findMemberContract() ?? null, renewals: mockVipRenewals.slice(0, 20) })),
  mock(memberRenewalContract.sign, ({ body, ok }) => {
    if (findMemberContract()) return badRequest('该业务已存在生效中的签约协议');
    const plan = mockDeductPlans.find((p) => p.id === body.planId);
    if (!plan) return notFound('扣款计划不存在');
    const payMethod = body.payMethod;
    const now = mockDateTime();
    const contract: PaymentContract = {
      id: getNextContractId(),
      contractNo: `CT${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`,
      channel: PAYMENT_METHOD_CHANNEL[payMethod],
      channelConfigId: payMethod === 'wechat_papay' ? 1 : 2,
      appId: payMethod === 'wechat_papay' ? 1 : 3,
      currency: 'CNY',
      planId: plan.id,
      planName: plan.name,
      planPeriod: plan.period,
      planAmount: plan.amount,
      signerAccount: '13800138000',
      signerName: '演示会员',
      status: 'signed',
      unknownOperation: null,
      version: 0,
      errorMessage: null,
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
  mock(memberRenewalContract.terminate, ({ ok }) => {
    const c = findMemberContract();
    if (!c) return notFound('未开通自动续费');
    c.status = 'terminated';
    c.version += 1;
    c.terminatedAt = mockDateTime();
    c.nextDeductAt = null;
    return ok(null, '已关闭自动续费');
  }),
  mock(memberRenewalContract.deduct, ({ ok }) => {
    const c = findMemberContract();
    if (!c) return notFound('未开通自动续费');
    if (c.status !== 'signed') return badRequest('协议未生效，无法扣款');
    return ok(simulateDeduct(c), '扣款执行完成');
  }),
];

export const paymentContractHandlers = [...planHandlers, ...contractHandlers, ...memberRenewalHandlers];
