/**
 * 会员充值记录服务：基于支付订单（bizType=member_recharge）。
 * 充值订单由 member-wallet.service 下单，bizId = String(memberId)。
 */
import { and, desc, eq, count, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { paymentOrders, members } from '../../db/schema';
import { dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { buildListResult } from '../../lib/list-query';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { currentUserOrNull } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { WALLET_RECHARGE_BIZ_TYPE } from './member-wallet.service';
import type { PaymentChannel, PaymentOrderStatus } from '@zenith/shared/payment';

export interface MemberRechargeQuery {
  keyword?: string;
  status?: PaymentOrderStatus;
  channel?: PaymentChannel;
  dateStart?: string;
  dateEnd?: string;
  page: number;
  pageSize: number;
}

interface RechargeRow {
  id: number;
  orderNo: string;
  outTradeNo: string;
  channelTradeNo: string | null;
  bizId: string;
  subject: string;
  amount: number;
  channel: PaymentChannel;
  payMethod: string;
  status: PaymentOrderStatus;
  paidAmount: number | null;
  paidAt: Date | null;
  expiredAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  memberNickname: string | null;
  memberPhone: string | null;
}

function mapRecharge(r: RechargeRow) {
  const memberId = Number(r.bizId);
  return {
    id: r.id,
    orderNo: r.orderNo,
    outTradeNo: r.outTradeNo,
    channelTradeNo: r.channelTradeNo,
    memberId: Number.isInteger(memberId) ? memberId : null,
    memberNickname: r.memberNickname,
    memberPhone: r.memberPhone,
    subject: r.subject,
    amount: r.amount,
    channel: r.channel,
    payMethod: r.payMethod,
    status: r.status,
    paidAmount: r.paidAmount,
    paidAt: formatNullableDateTime(r.paidAt),
    expiredAt: formatNullableDateTime(r.expiredAt),
    errorMessage: r.errorMessage,
    createdAt: formatDateTime(r.createdAt),
  };
}

export function buildRechargeWhere(q: Omit<MemberRechargeQuery, 'page' | 'pageSize'>): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(paymentOrders.bizType, WALLET_RECHARGE_BIZ_TYPE)];
  const adminUser = currentUserOrNull();
  if (adminUser) {
    // Keep both sides of the join in the active tenant scope. Filtering only
    // payment_orders would still expose a mismatched member name if legacy
    // rows ever contain an inconsistent member reference.
    const orderScope = tenantCondition(paymentOrders, adminUser);
    const memberScope = tenantCondition(members, adminUser);
    if (orderScope) conds.push(orderScope);
    if (memberScope) conds.push(memberScope);
  }
  conds.push(keywordCondition(q.keyword, [paymentOrders.orderNo, paymentOrders.outTradeNo, members.nickname, members.phone]));
  if (q.status) conds.push(eq(paymentOrders.status, q.status));
  if (q.channel) conds.push(eq(paymentOrders.channel, q.channel));
  conds.push(...dateRangeConditions(paymentOrders.createdAt, q.dateStart, q.dateEnd));
  return and(...conds);
}

export async function listMemberRecharges(q: MemberRechargeQuery) {
  const where = buildRechargeWhere(q);
  const joinOn = sql`${members.id}::text = ${paymentOrders.bizId}`;
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.select({ value: count() })
      .from(paymentOrders)
      .leftJoin(members, joinOn)
      .where(where)
      .then((r) => r[0]?.value ?? 0),
    rows: () => db.select({
      id: paymentOrders.id,
      orderNo: paymentOrders.orderNo,
      outTradeNo: paymentOrders.outTradeNo,
      channelTradeNo: paymentOrders.channelTradeNo,
      bizId: paymentOrders.bizId,
      subject: paymentOrders.subject,
      amount: paymentOrders.amount,
      channel: paymentOrders.channel,
      payMethod: paymentOrders.payMethod,
      status: paymentOrders.status,
      paidAmount: paymentOrders.paidAmount,
      paidAt: paymentOrders.paidAt,
      expiredAt: paymentOrders.expiredAt,
      errorMessage: paymentOrders.errorMessage,
      createdAt: paymentOrders.createdAt,
      memberNickname: members.nickname,
      memberPhone: members.phone,
    })
      .from(paymentOrders)
      .leftJoin(members, joinOn)
      .where(where)
      .orderBy(desc(paymentOrders.id))
      .limit(q.pageSize)
      .offset(pageOffset(q.page, q.pageSize)),
    map: (r) => mapRecharge(r as RechargeRow),
  });
}
