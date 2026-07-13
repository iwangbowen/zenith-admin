/**
 * 会员自动续费 Service（前台签约代扣入口）。
 *
 * 签约：bizType=member_renewal，bizId=会员 ID，复用支付中心签约代扣能力；
 * 扣款成功事件（payment.succeeded）订阅者幂等延长 members.vipExpireAt，
 * 幂等键为 member_vip_renewals.orderNo 唯一约束 + 事务级咨询锁（与钱包充值同模式）。
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { members, memberVipRenewals, paymentContracts, paymentDeductPlans, type MemberVipRenewalRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
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
import type { MemberRenewalInfo, MemberSignRenewalInput, MemberVipRenewal, PaymentDeductPlan } from '@zenith/shared';
import { MEMBER_RENEWAL_BIZ_TYPE } from '@zenith/shared';
import { allDeductPlans } from '../payment/payment-contract.service';

function mapRenewal(row: MemberVipRenewalRow): MemberVipRenewal {
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
export async function listRenewalPlans(): Promise<PaymentDeductPlan[]> {
  return allDeductPlans();
}

/** 我的自动续费状态：VIP 到期时间 + 当前协议 + 续费记录 */
export async function getMyRenewal(memberId: number): Promise<MemberRenewalInfo> {
  const member = await ensureMemberExists(memberId);
  const contract = await db.query.paymentContracts.findFirst({
    where: and(
      eq(paymentContracts.bizType, MEMBER_RENEWAL_BIZ_TYPE),
      eq(paymentContracts.bizId, String(memberId)),
      sql`${paymentContracts.status} in ('pending', 'signed', 'paused')`,
    ),
    with: { plan: { columns: { name: true, period: true, amount: true } } },
  });
  const renewals = await db
    .select()
    .from(memberVipRenewals)
    .where(eq(memberVipRenewals.memberId, memberId))
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
  return signContract({
    planId: input.planId,
    payMethod: input.payMethod,
    signerAccount: member.phone ?? member.username ?? member.email ?? `member-${memberId}`,
    signerName: member.nickname,
    bizType: MEMBER_RENEWAL_BIZ_TYPE,
    bizId: String(memberId),
    remark: '会员自动续费',
    tenantId: null,
    firstDeductNow: true,
  });
}

/** 解约自动续费（仅本人协议） */
export async function terminateMyRenewal(memberId: number): Promise<void> {
  const contract = await findActiveContractByBiz(MEMBER_RENEWAL_BIZ_TYPE, String(memberId));
  if (!contract) throw new HTTPException(404, { message: '未开通自动续费' });
  await terminateContract(contract);
}

/** 会员端手动补扣一期（演示用：到期前手动续费） */
export async function deductMyRenewalNow(memberId: number) {
  const contract = await findActiveContractByBiz(MEMBER_RENEWAL_BIZ_TYPE, String(memberId));
  if (!contract) throw new HTTPException(404, { message: '未开通自动续费' });
  if (contract.status !== 'signed') throw new HTTPException(400, { message: '协议未生效，无法扣款' });
  return executeDeduction(contract);
}

/**
 * 支付成功事件触发 VIP 延期（按订单号幂等，防重投重复延期）。
 * 事务级咨询锁串行化并发重投；幂等检查与延期同一事务提交。
 */
export async function extendVipOnRenewal(event: { bizId: string; orderNo: string; amount: number }): Promise<void> {
  const memberId = Number(event.bizId);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    logger.warn('[MemberRenewal] 续费延期 bizId 非法', { bizId: event.bizId });
    return;
  }
  const extended = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`vip-renewal:${event.orderNo}`}))`);
    const [exist] = await tx.select({ id: memberVipRenewals.id }).from(memberVipRenewals).where(eq(memberVipRenewals.orderNo, event.orderNo)).limit(1);
    if (exist) return false;

    const [member] = await tx.select({ vipExpireAt: members.vipExpireAt }).from(members).where(eq(members.id, memberId)).limit(1);
    if (!member) {
      logger.warn('[MemberRenewal] 会员不存在，跳过延期', { memberId, orderNo: event.orderNo });
      return false;
    }
    const [contract] = await tx
      .select({ contractNo: paymentContracts.contractNo, planId: paymentContracts.planId })
      .from(paymentContracts)
      .where(and(eq(paymentContracts.bizType, MEMBER_RENEWAL_BIZ_TYPE), eq(paymentContracts.bizId, event.bizId)))
      .orderBy(desc(paymentContracts.id))
      .limit(1);
    const plan = contract
      ? await tx.query.paymentDeductPlans.findFirst({ where: eq(paymentDeductPlans.id, contract.planId) })
      : null;

    // 到期前续费从当前到期时间顺延；已过期/未开通从当下起算
    const now = new Date();
    const base = member.vipExpireAt && member.vipExpireAt > now ? member.vipExpireAt : now;
    const newExpire = plan ? advanceVipExpiry(base, plan) : advanceVipExpiry(base, { period: 'monthly', customDays: null });

    await tx.insert(memberVipRenewals).values({
      memberId,
      orderNo: event.orderNo,
      contractNo: contract?.contractNo ?? null,
      amount: event.amount,
      vipExpireAfter: newExpire,
    });
    await tx.update(members).set({ vipExpireAt: newExpire }).where(eq(members.id, memberId));
    return true;
  });
  if (extended) logger.info('[MemberRenewal] VIP 续费延期成功', { memberId, orderNo: event.orderNo });
}
