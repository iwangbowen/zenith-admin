/**
 * 交易投诉/争议 Service。
 *
 * 对标微信支付投诉 / 支付宝交易投诉的商户处理台：本地聚合工单（payment_disputes）
 * + 处理时间线（payment_dispute_replies）。渠道拉单由 cron syncPaymentDisputes 完成
 * （沙箱渠道对近期成功订单生成模拟投诉，便于演示；真实渠道 API 需商户开通投诉权限）。
 *
 * 状态机：pending →(商户回复) processing →(完结/退款) resolved | refunded。
 * 投诉退款直接复用支付中心 refund()（含审批阈值链路），退款单号回填工单。
 */
import { and, desc, eq, gte, inArray, like, lt, notInArray, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import dayjs from 'dayjs';
import { db } from '../../db';
import {
  paymentChannelConfigs,
  paymentDisputeReplies,
  paymentDisputes,
  paymentOrders,
  type PaymentDisputeReplyRow,
  type PaymentDisputeRow,
} from '../../db/schema';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { refund } from './payment.service';
import logger from '../../lib/logger';
import type {
  PaymentChannel,
  PaymentDispute,
  PaymentDisputeDetail,
  PaymentDisputeReply,
  PaymentDisputeStats,
  PaymentDisputeStatus,
  PaymentDisputeType,
  RefundPaymentDisputeInput,
} from '@zenith/shared';

const OPEN_STATUSES: PaymentDisputeStatus[] = ['pending', 'processing'];
/** 模拟拉单：保持未完结工单不超过该数量，避免演示环境刷屏 */
const SYNC_MAX_OPEN = 3;
/** 默认处理时效（小时） */
const DEFAULT_DEADLINE_HOURS = 24;

function genNo(): string {
  return `DSP${Date.now()}${randomInt(1000, 9999)}`;
}

function isOverdue(row: PaymentDisputeRow): boolean {
  return OPEN_STATUSES.includes(row.status) && row.deadline != null && row.deadline.getTime() < Date.now();
}

export function mapDispute(row: PaymentDisputeRow): PaymentDispute {
  return {
    id: row.id,
    disputeNo: row.disputeNo,
    channelDisputeNo: row.channelDisputeNo ?? null,
    channel: row.channel,
    orderNo: row.orderNo,
    complainant: row.complainant ?? null,
    complainantPhone: row.complainantPhone ?? null,
    type: row.type,
    content: row.content,
    amount: row.amount,
    status: row.status,
    deadline: formatNullableDateTime(row.deadline),
    overdue: isOverdue(row),
    refundNo: row.refundNo ?? null,
    resolvedAt: formatNullableDateTime(row.resolvedAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapReply(row: PaymentDisputeReplyRow & { operator?: { nickname: string | null } | null }): PaymentDisputeReply {
  return {
    id: row.id,
    author: row.author,
    content: row.content,
    operatorName: row.operator?.nickname ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────

export interface ListDisputesQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: PaymentDisputeStatus;
  channel?: PaymentChannel;
  type?: PaymentDisputeType;
  overdueOnly?: boolean;
  startTime?: string;
  endTime?: string;
}

function disputesTenantCondition() {
  const user = currentUserOrNull();
  return user ? tenantCondition(paymentDisputes, user) : undefined;
}

export async function buildDisputesWhere(q: ListDisputesQuery) {
  const conds = [];
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    conds.push(or(like(paymentDisputes.disputeNo, kw), like(paymentDisputes.orderNo, kw), like(paymentDisputes.complainant, kw)));
  }
  if (q.status) conds.push(eq(paymentDisputes.status, q.status));
  if (q.channel) conds.push(eq(paymentDisputes.channel, q.channel));
  if (q.type) conds.push(eq(paymentDisputes.type, q.type));
  if (q.overdueOnly) {
    conds.push(inArray(paymentDisputes.status, OPEN_STATUSES));
    conds.push(lt(paymentDisputes.deadline, new Date()));
  }
  const start = parseDateRangeStart(q.startTime);
  const end = parseDateRangeEnd(q.endTime);
  if (start) conds.push(gte(paymentDisputes.createdAt, start));
  if (end) conds.push(sql`${paymentDisputes.createdAt} <= ${end}`);
  return mergeWhere(conds.length ? and(...conds) : undefined, disputesTenantCondition());
}

export async function listDisputes(q: ListDisputesQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const where = await buildDisputesWhere(q);
  const [total, rows] = await Promise.all([
    db.$count(paymentDisputes, where),
    withPagination(db.select().from(paymentDisputes).where(where).orderBy(desc(paymentDisputes.id)).$dynamic(), page, pageSize),
  ]);
  return { list: rows.map(mapDispute), total, page, pageSize };
}

export async function ensureDispute(id: number): Promise<PaymentDisputeRow> {
  const [row] = await db.select().from(paymentDisputes).where(and(eq(paymentDisputes.id, id), disputesTenantCondition())).limit(1);
  if (!row) throw new HTTPException(404, { message: '投诉工单不存在' });
  return row;
}

export async function getDisputeDetail(id: number): Promise<PaymentDisputeDetail> {
  const row = await db.query.paymentDisputes.findFirst({
    where: mergeWhere(eq(paymentDisputes.id, id), disputesTenantCondition()),
    with: { replies: { with: { operator: { columns: { nickname: true } } }, orderBy: paymentDisputeReplies.id } },
  });
  if (!row) throw new HTTPException(404, { message: '投诉工单不存在' });
  const [order] = await db
    .select({ orderNo: paymentOrders.orderNo, subject: paymentOrders.subject, amount: paymentOrders.amount, status: paymentOrders.status, paidAt: paymentOrders.paidAt })
    .from(paymentOrders)
    .where(eq(paymentOrders.orderNo, row.orderNo))
    .limit(1);
  return {
    ...mapDispute(row),
    replies: row.replies.map(mapReply),
    order: order ? { ...order, paidAt: formatNullableDateTime(order.paidAt) } : null,
  };
}

// ─── 统计 ─────────────────────────────────────────────────────────────────────

export async function getDisputeStats(): Promise<PaymentDisputeStats> {
  const tc = disputesTenantCondition();
  const since30d = dayjs().subtract(30, 'day').toDate();
  const [open, overdue, last30dCount, last30dOrders, resolvedRows] = await Promise.all([
    db.$count(paymentDisputes, mergeWhere(inArray(paymentDisputes.status, OPEN_STATUSES), tc)),
    db.$count(paymentDisputes, mergeWhere(and(inArray(paymentDisputes.status, OPEN_STATUSES), lt(paymentDisputes.deadline, new Date())), tc)),
    db.$count(paymentDisputes, mergeWhere(gte(paymentDisputes.createdAt, since30d), tc)),
    db.$count(paymentOrders, and(inArray(paymentOrders.status, ['success', 'refunding', 'refunded']), gte(paymentOrders.createdAt, since30d))),
    db
      .select({ avgHours: sql<number>`coalesce(avg(extract(epoch from (${paymentDisputes.resolvedAt} - ${paymentDisputes.createdAt})) / 3600), 0)` })
      .from(paymentDisputes)
      .where(mergeWhere(and(notInArray(paymentDisputes.status, OPEN_STATUSES), sql`${paymentDisputes.resolvedAt} is not null`), tc)),
  ]);
  const rate = last30dOrders > 0 ? Number(((last30dCount / last30dOrders) * 100).toFixed(2)) : 0;
  return { open, overdue, last30dCount, last30dRate: rate, avgResolveHours: Number(Number(resolvedRows[0]?.avgHours ?? 0).toFixed(1)) };
}

// ─── 处理动作 ─────────────────────────────────────────────────────────────────

async function appendReply(disputeId: number, author: 'merchant' | 'user' | 'system', content: string, operatorId?: number | null): Promise<void> {
  await db.insert(paymentDisputeReplies).values({ disputeId, author, content, operatorId: operatorId ?? null });
}

/** 商户回复：pending → processing */
export async function replyDispute(id: number, content: string): Promise<PaymentDisputeDetail> {
  const row = await ensureDispute(id);
  if (!OPEN_STATUSES.includes(row.status)) throw new HTTPException(400, { message: '工单已完结，无法回复' });
  await appendReply(id, 'merchant', content, currentUser().userId);
  await db.update(paymentDisputes).set({ status: 'processing' }).where(and(eq(paymentDisputes.id, id), eq(paymentDisputes.status, 'pending')));
  return getDisputeDetail(id);
}

/** 完结工单（协商解决，无需退款） */
export async function resolveDispute(id: number, remark?: string): Promise<PaymentDisputeDetail> {
  const row = await ensureDispute(id);
  if (!OPEN_STATUSES.includes(row.status)) throw new HTTPException(400, { message: '工单已完结' });
  await appendReply(id, 'system', remark ? `工单已完结：${remark}` : '工单已完结', currentUser().userId);
  await db.update(paymentDisputes).set({ status: 'resolved', resolvedAt: new Date() }).where(and(eq(paymentDisputes.id, id), inArray(paymentDisputes.status, OPEN_STATUSES)));
  return getDisputeDetail(id);
}

/** 投诉退款：复用支付中心退款（含大额审批链路），退款单号回填工单并完结 */
export async function refundDispute(id: number, input: RefundPaymentDisputeInput): Promise<PaymentDisputeDetail> {
  const row = await ensureDispute(id);
  if (!OPEN_STATUSES.includes(row.status)) throw new HTTPException(400, { message: '工单已完结' });
  if (row.refundNo) throw new HTTPException(400, { message: `该工单已发起退款（${row.refundNo}）` });
  const refundAmount = input.refundAmount ?? row.amount;
  if (refundAmount <= 0) throw new HTTPException(400, { message: '退款金额必须大于 0' });
  const res = await refund({
    orderNo: row.orderNo,
    refundAmount,
    reason: input.reason ?? `交易投诉退款（${row.disputeNo}）`,
    operatorId: currentUser().userId,
  });
  await appendReply(id, 'system', `已发起退款 ${res.refundNo}（${(refundAmount / 100).toFixed(2)} 元，状态：${res.status}）`, currentUser().userId);
  await db
    .update(paymentDisputes)
    .set({ refundNo: res.refundNo, status: 'refunded', resolvedAt: new Date() })
    .where(and(eq(paymentDisputes.id, id), inArray(paymentDisputes.status, OPEN_STATUSES)));
  return getDisputeDetail(id);
}

// ─── 渠道拉单（cron / 手动模拟）──────────────────────────────────────────────

const MOCK_COMPLAINTS: Array<{ type: PaymentDisputeType; content: string }> = [
  { type: 'refund_request', content: '商品与描述不符，申请全额退款。' },
  { type: 'refund_request', content: '重复扣款，请核实并退回多扣金额。' },
  { type: 'service_issue', content: '付款成功后长时间未到账/未发货，请尽快处理。' },
  { type: 'service_issue', content: '联系客服无人响应，问题一直未解决。' },
  { type: 'fraud_report', content: '怀疑该笔交易为他人冒用本人账户支付，要求核查。' },
  { type: 'other', content: '发票信息开具错误，需要重开。' },
];

/** 为一笔成功订单生成模拟投诉（演示：对标渠道投诉 API 拉单） */
async function createMockDispute(order: { orderNo: string; channel: PaymentChannel; amount: number; openId: string | null; tenantId: number | null }): Promise<PaymentDisputeRow> {
  const tpl = MOCK_COMPLAINTS[randomInt(0, MOCK_COMPLAINTS.length)];
  const [row] = await db
    .insert(paymentDisputes)
    .values({
      disputeNo: genNo(),
      channelDisputeNo: `${order.channel === 'wechat' ? 'WXC' : order.channel === 'alipay' ? 'ALIC' : 'UPC'}${Date.now()}${randomInt(100, 999)}`,
      channel: order.channel,
      orderNo: order.orderNo,
      complainant: order.openId ?? `user_${randomInt(1000, 9999)}`,
      complainantPhone: `138****${String(randomInt(0, 9999)).padStart(4, '0')}`,
      type: tpl.type,
      content: tpl.content,
      amount: order.amount,
      status: 'pending',
      deadline: dayjs().add(DEFAULT_DEADLINE_HOURS, 'hour').toDate(),
      tenantId: order.tenantId,
    })
    .returning();
  await appendReply(row.id, 'user', tpl.content);
  return row;
}

/**
 * Cron：同步渠道投诉单。沙箱/演示模式下对近 7 天成功且未被投诉的订单生成模拟投诉
 * （未完结工单达到上限时跳过），真实渠道拉单需商户开通投诉 API 权限后扩展。
 * 返回新增工单数。
 */
export async function syncPaymentDisputes(): Promise<number> {
  const openCount = await db.$count(paymentDisputes, inArray(paymentDisputes.status, OPEN_STATUSES));
  if (openCount >= SYNC_MAX_OPEN) return 0;
  // 仅对沙箱渠道配置的订单生成模拟投诉，避免真实环境误造数据
  const since = dayjs().subtract(7, 'day').toDate();
  const candidates = await db
    .select({
      orderNo: paymentOrders.orderNo,
      channel: paymentOrders.channel,
      amount: paymentOrders.amount,
      openId: paymentOrders.openId,
      tenantId: paymentOrders.tenantId,
    })
    .from(paymentOrders)
    .innerJoin(paymentChannelConfigs, eq(paymentOrders.channelConfigId, paymentChannelConfigs.id))
    .where(
      and(
        eq(paymentOrders.status, 'success'),
        gte(paymentOrders.createdAt, since),
        eq(paymentChannelConfigs.sandbox, true),
        sql`not exists (select 1 from ${paymentDisputes} where ${paymentDisputes.orderNo} = ${paymentOrders.orderNo})`,
      ),
    )
    .orderBy(desc(paymentOrders.id))
    .limit(10);
  if (candidates.length === 0) return 0;
  const order = candidates[randomInt(0, candidates.length)];
  const row = await createMockDispute(order);
  logger.info('[payment-dispute] mock dispute pulled', { disputeNo: row.disputeNo, orderNo: order.orderNo });
  return 1;
}

/** 手动模拟一条投诉（演示/联调）：可指定订单号，否则取最近一笔成功订单 */
export async function simulateDispute(orderNo?: string): Promise<PaymentDispute> {
  let order: { orderNo: string; channel: PaymentChannel; amount: number; openId: string | null; tenantId: number | null } | undefined;
  const base = db
    .select({
      orderNo: paymentOrders.orderNo,
      channel: paymentOrders.channel,
      amount: paymentOrders.amount,
      openId: paymentOrders.openId,
      tenantId: paymentOrders.tenantId,
    })
    .from(paymentOrders);
  if (orderNo) {
    [order] = await base.where(eq(paymentOrders.orderNo, orderNo)).limit(1);
    if (!order) throw new HTTPException(404, { message: '支付订单不存在' });
    const dup = await db.$count(paymentDisputes, and(eq(paymentDisputes.orderNo, orderNo), inArray(paymentDisputes.status, OPEN_STATUSES)));
    if (dup > 0) throw new HTTPException(400, { message: '该订单已存在未完结投诉' });
  } else {
    [order] = await base
      .where(and(eq(paymentOrders.status, 'success'), sql`not exists (select 1 from ${paymentDisputes} where ${paymentDisputes.orderNo} = ${paymentOrders.orderNo})`))
      .orderBy(desc(paymentOrders.id))
      .limit(1);
    if (!order) throw new HTTPException(400, { message: '没有可用于模拟投诉的成功订单' });
  }
  return mapDispute(await createMockDispute(order));
}
