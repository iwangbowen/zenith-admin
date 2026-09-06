/**
 * 会员自动续费 Service（前台签约代扣入口）。
 *
 * 签约：bizType=member_renewal，bizId=会员 ID，复用支付中心签约代扣能力；
 * 扣款成功事件（payment.succeeded）订阅者幂等延长 members.vipExpireAt，
 * 幂等键为 member_vip_renewals.orderNo 唯一约束 + 事务级咨询锁（与钱包充值同模式）。
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { exactTenantCondition } from '../../lib/tenant';
import { members, memberVipRenewals, paymentApps, paymentContracts, paymentDeductPlans, paymentOrders, type MemberVipRenewalRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import logger from '../../lib/logger';
import {
  advanceVipExpiry,
  executeDeduction,
  findActiveContractByBiz,
  mapContract,
  signContract,
  terminateContract,
  type SignContractResult,
} from '../payment/payment-contract.service';
import { ensureMemberExists } from './member-auth.service';
import type { MemberRenewalInfo, MemberSignRenewalInput, MemberVipRenewal } from '@zenith/shared/member';
import type { PaymentDeductPlan } from '@zenith/shared/payment';
import { MEMBER_RENEWAL_BIZ_TYPE } from '@zenith/shared/member';
import { allDeductPlans } from '../payment/payment-contract.service';

async function ensureMemberPaymentApplication(applicationId: number, tenantId: number | null) {
  const [app] = await db.select({ id: paymentApps.id }).from(paymentApps).where(and(
    eq(paymentApps.id, applicationId),
    eq(paymentApps.status, 'enabled'),
    exactTenantCondition(paymentApps.tenantId, tenantId),
  )).limit(1);
  if (!app) throw new HTTPException(400, { message: '支付应用不存在、未启用或不属于当前会员租户' });
}

function mapRenewal(row: Pick<MemberVipRenewalRow, 'id' | 'orderNo' | 'contractNo' | 'amount' | 'vipExpireAfter' | 'createdAt'>): MemberVipRenewal {
  return {
    id: row.id,
    orderNo: row.orderNo,
    contractNo: row.contractNo ?? null,
    amount: row.amount,
    vipExpireAfter: formatDateTime(row.vipExpireAfter),
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 会员端可选续费计划（启用中的计划公开视图） */
export async function listRenewalPlans(applicationId: number, memberId: number): Promise<PaymentDeductPlan[]> {
  const member = await ensureMemberExists(memberId);
  await ensureMemberPaymentApplication(applicationId, member.tenantId ?? null);
  return allDeductPlans({ tenantId: member.tenantId ?? null });
}

/** 我的自动续费状态：VIP 到期时间 + 当前协议 + 续费记录 */
export async function getMyRenewal(memberId: number, applicationId: number): Promise<MemberRenewalInfo> {
  const member = await ensureMemberExists(memberId);
  await ensureMemberPaymentApplication(applicationId, member.tenantId ?? null);
  const contract = await db.query.paymentContracts.findFirst({
    where: and(
      eq(paymentContracts.bizType, MEMBER_RENEWAL_BIZ_TYPE),
      eq(paymentContracts.bizId, String(memberId)),
      eq(paymentContracts.appId, applicationId),
      eq(paymentContracts.currency, 'CNY'),
      exactTenantCondition(paymentContracts.tenantId, member.tenantId),
      sql`${paymentContracts.status} in ('pending', 'unknown', 'signed', 'paused')`,
    ),
    with: { plan: { columns: { name: true, period: true, amount: true } } },
  });
  const renewals = await db
    .select({
      id: memberVipRenewals.id,
      orderNo: memberVipRenewals.orderNo,
      contractNo: memberVipRenewals.contractNo,
      amount: memberVipRenewals.amount,
      vipExpireAfter: memberVipRenewals.vipExpireAfter,
      createdAt: memberVipRenewals.createdAt,
    })
    .from(memberVipRenewals)
    .innerJoin(paymentOrders, eq(paymentOrders.orderNo, memberVipRenewals.orderNo))
    .where(and(
      eq(memberVipRenewals.memberId, memberId),
      eq(paymentOrders.appId, applicationId),
      eq(paymentOrders.currency, 'CNY'),
      exactTenantCondition(paymentOrders.tenantId, member.tenantId),
    ))
    .orderBy(desc(memberVipRenewals.id))
    .limit(20);
  return {
    vipExpireAt: formatNullableDateTime(member.vipExpireAt),
    contract: contract ? mapContract(contract) : null,
    renewals: renewals.map(mapRenewal),
  };
}

/** 签约自动续费（sandbox 渠道即时生效并执行首期扣款） */
export async function signRenewal(memberId: number, input: MemberSignRenewalInput): Promise<SignContractResult> {
  const member = await ensureMemberExists(memberId);
  const tenantScope = exactTenantCondition(paymentContracts.tenantId, member.tenantId);
  const [existing] = await db.select({ id: paymentContracts.id, appId: paymentContracts.appId }).from(paymentContracts).where(and(
    eq(paymentContracts.bizType, MEMBER_RENEWAL_BIZ_TYPE),
    eq(paymentContracts.bizId, String(memberId)),
    eq(paymentContracts.currency, 'CNY'),
    tenantScope,
    sql`${paymentContracts.status} in ('pending', 'unknown', 'signed', 'paused')`,
  )).limit(1);
  if (existing) throw new HTTPException(409, { message: '该会员已存在生效中的自动续费协议，请先关闭原协议' });
  return signContract({
    applicationId: input.applicationId,
    planId: input.planId,
    payMethod: input.payMethod,
    currency: input.currency,
    signerAccount: member.phone ?? member.username ?? member.email ?? `member-${memberId}`,
    signerName: member.nickname,
    bizType: MEMBER_RENEWAL_BIZ_TYPE,
    bizId: String(memberId),
    remark: '会员自动续费',
    tenantId: member.tenantId ?? null,
    firstDeductNow: true,
  });
}

/** 解约自动续费（仅本人协议） */
export async function terminateMyRenewal(memberId: number, applicationId: number): Promise<void> {
  const member = await ensureMemberExists(memberId);
  const contract = await findActiveContractByBiz({ bizType: MEMBER_RENEWAL_BIZ_TYPE, bizId: String(memberId), tenantId: member.tenantId ?? null, applicationId, currency: 'CNY' });
  await terminateContract(requireRow(contract, '未开通自动续费'));
}

/** 会员端手动补扣一期（演示用：到期前手动续费） */
export async function deductMyRenewalNow(memberId: number, applicationId: number) {
  const member = await ensureMemberExists(memberId);
  const contract = await findActiveContractByBiz({ bizType: MEMBER_RENEWAL_BIZ_TYPE, bizId: String(memberId), tenantId: member.tenantId ?? null, applicationId, currency: 'CNY' });
  const activeContract = requireRow(contract, '未开通自动续费');
  if (activeContract.status !== 'signed') throw new HTTPException(400, { message: '协议未生效，无法扣款' });
  return executeDeduction(activeContract);
}

/**
 * 支付成功事件触发 VIP 延期（按订单号幂等，防重投重复延期）。
 * 事务级咨询锁串行化并发重投；幂等检查与延期同一事务提交。
 */
export async function extendVipOnRenewal(event: { bizId: string; orderNo: string; amount: number; appId?: number | null; tenantId?: number | null }): Promise<void> {
  const memberId = Number(event.bizId);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    logger.warn('[MemberRenewal] 续费延期 bizId 非法', { bizId: event.bizId });
    return;
  }
  const extended = await db.transaction(async (tx) => {
    // Serialize all successful renewals for the same member, not only
    // duplicate delivery of one order. The row lock makes the expiry read and
    // write atomic even when two different orders settle concurrently.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`vip-renewal-member:${memberId}`}))`);
    const [exist] = await tx.select({ id: memberVipRenewals.id }).from(memberVipRenewals).where(eq(memberVipRenewals.orderNo, event.orderNo)).limit(1);
    if (exist) return false;

    const [order] = await tx.select({
      appId: paymentOrders.appId,
      currency: paymentOrders.currency,
      tenantId: paymentOrders.tenantId,
      status: paymentOrders.status,
      bizType: paymentOrders.bizType,
      bizId: paymentOrders.bizId,
      amount: paymentOrders.amount,
      paidAmount: paymentOrders.paidAmount,
    }).from(paymentOrders).where(eq(paymentOrders.orderNo, event.orderNo)).limit(1);
    if (!order || event.appId == null || order.appId !== event.appId || order.status !== 'success' || order.bizType !== MEMBER_RENEWAL_BIZ_TYPE || order.bizId !== event.bizId || (order.amount !== event.amount && order.paidAmount !== event.amount)) {
      logger.warn('[MemberRenewal] 续费订单作用域或状态不匹配，跳过延期', { orderNo: event.orderNo });
      return false;
    }

    const [member] = await tx.select({ vipExpireAt: members.vipExpireAt, status: members.status, deletedAt: members.deletedAt }).from(members).where(and(
      eq(members.id, memberId),
      isNull(members.deletedAt),
      exactTenantCondition(members.tenantId, order.tenantId),
    )).for('update').limit(1);
    if (!member || member.status === 'banned') {
      logger.warn('[MemberRenewal] 会员不存在，跳过延期', { memberId, orderNo: event.orderNo });
      return false;
    }
    const [contract] = await tx
      .select({ contractNo: paymentContracts.contractNo, planId: paymentContracts.planId })
      .from(paymentContracts)
      .where(and(
        eq(paymentContracts.bizType, MEMBER_RENEWAL_BIZ_TYPE),
        eq(paymentContracts.bizId, event.bizId),
        eq(paymentContracts.appId, order.appId),
        eq(paymentContracts.currency, order.currency),
        exactTenantCondition(paymentContracts.tenantId, order.tenantId),
      ))
      .orderBy(desc(paymentContracts.id))
      .limit(1);
    const plan = contract
      ? await tx.query.paymentDeductPlans.findFirst({ where: and(
          eq(paymentDeductPlans.id, contract.planId),
          exactTenantCondition(paymentDeductPlans.tenantId, order.tenantId),
        ) })
      : null;

    // 到期前续费从当前到期时间顺延；已过期/未开通从当下起算
    const now = new Date();
    const base = member.vipExpireAt && member.vipExpireAt > now ? member.vipExpireAt : now;
    const newExpire = plan ? advanceVipExpiry(base, plan) : advanceVipExpiry(base, { period: 'monthly', customDays: null });

    await tx.insert(memberVipRenewals).values({
      memberId,
      orderNo: event.orderNo,
      contractNo: contract?.contractNo ?? null,
      amount: order.amount,
      vipExpireAfter: newExpire,
    });
    await tx.update(members).set({ vipExpireAt: newExpire }).where(eq(members.id, memberId));
    return true;
  });
  if (extended) logger.info('[MemberRenewal] VIP 续费延期成功', { memberId, orderNo: event.orderNo });
}
