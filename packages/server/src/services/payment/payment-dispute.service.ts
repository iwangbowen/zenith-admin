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
import { and, desc, eq, gte, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { genPaymentNo } from './payment-no';
import dayjs from 'dayjs';
import { config } from '../../config';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import {
  paymentChannelConfigs,
  paymentDisputeReplies,
  paymentDisputes,
  paymentOrders,
  paymentRefunds,
  type PaymentDisputeReplyRow,
  type PaymentDisputeRow,
} from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { refund } from './payment.service';
import { decide } from '../platform/rules-runtime.service';
import logger from '../../lib/logger';
import type { PaymentChannel, PaymentDispute, PaymentDisputeDetail, PaymentDisputeReply, PaymentDisputeStats, PaymentDisputeStatus, PaymentDisputeType, RefundPaymentDisputeInput } from '@zenith/shared/payment';
import { PAYMENT_DISPUTE_ROUTE_LABELS } from '@zenith/shared/payment';

const OPEN_STATUSES: PaymentDisputeStatus[] = ['pending', 'processing'];
/** 模拟拉单：保持未完结工单不超过该数量，避免演示环境刷屏 */
const SYNC_MAX_OPEN = 3;
/** 默认处理时效（小时） */
const DEFAULT_DEADLINE_HOURS = 24;

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
    route: row.route ?? null,
    priority: row.priority ?? null,
    slaHours: row.slaHours ?? null,
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
  /** 分流路由筛选（urgent/manual/auto_refund_suggest） */
  route?: string;
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
  conds.push(keywordCondition(q.keyword, [paymentDisputes.disputeNo, paymentDisputes.orderNo, paymentDisputes.complainant]));
  if (q.status) conds.push(eq(paymentDisputes.status, q.status));
  if (q.channel) conds.push(eq(paymentDisputes.channel, q.channel));
  if (q.type) conds.push(eq(paymentDisputes.type, q.type));
  if (q.route) conds.push(eq(paymentDisputes.route, q.route));
  if (q.overdueOnly) {
    conds.push(inArray(paymentDisputes.status, OPEN_STATUSES));
    conds.push(lt(paymentDisputes.deadline, new Date()));
  }
  const start = parseDateRangeStart(q.startTime);
  const end = parseDateRangeEnd(q.endTime);
  if (start) conds.push(gte(paymentDisputes.createdAt, start));
  if (end) conds.push(lte(paymentDisputes.createdAt, end));
  return buildWhere(...conds, disputesTenantCondition());
}

export async function listDisputes(q: ListDisputesQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const where = await buildDisputesWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentDisputes, where),
    rows: () => withPagination(db.select().from(paymentDisputes).where(where).orderBy(desc(paymentDisputes.id)).$dynamic(), page, pageSize),
    map: mapDispute,
  });
}

export async function ensureDispute(id: number): Promise<PaymentDisputeRow> {
  const [row] = await db.select().from(paymentDisputes).where(and(eq(paymentDisputes.id, id), disputesTenantCondition())).limit(1);
  requireRow(row, '投诉工单不存在');
  return row;
}

export async function getDisputeDetail(id: number): Promise<PaymentDisputeDetail> {
  const row = requireRow(await db.query.paymentDisputes.findFirst({
    where: buildWhere(eq(paymentDisputes.id, id), disputesTenantCondition()),
    with: { replies: { with: { operator: { columns: { nickname: true } } }, orderBy: paymentDisputeReplies.id } },
  }), '投诉工单不存在');
  const [order] = await db
    .select({ orderNo: paymentOrders.orderNo, subject: paymentOrders.subject, amount: paymentOrders.amount, status: paymentOrders.status, paidAt: paymentOrders.paidAt })
    .from(paymentOrders)
    .where(and(eq(paymentOrders.orderNo, row.orderNo), exactTenantCondition(paymentOrders.tenantId, row.tenantId)))
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
  const orderTenant = tenantCondition(paymentOrders, currentUser());
  const since30d = dayjs().subtract(30, 'day').toDate();
  const [open, overdue, last30dCount, last30dOrders, resolvedRows] = await Promise.all([
    db.$count(paymentDisputes, buildWhere(inArray(paymentDisputes.status, OPEN_STATUSES), tc)),
    db.$count(paymentDisputes, buildWhere(and(inArray(paymentDisputes.status, OPEN_STATUSES), lt(paymentDisputes.deadline, new Date())), tc)),
    db.$count(paymentDisputes, buildWhere(gte(paymentDisputes.createdAt, since30d), tc)),
    db.$count(paymentOrders, buildWhere(and(inArray(paymentOrders.status, ['success', 'refunding', 'refunded']), gte(paymentOrders.createdAt, since30d)), orderTenant)),
    db
      .select({ avgHours: sql<number>`coalesce(avg(extract(epoch from (${paymentDisputes.resolvedAt} - ${paymentDisputes.createdAt})) / 3600), 0)` })
      .from(paymentDisputes)
      .where(buildWhere(and(notInArray(paymentDisputes.status, OPEN_STATUSES), sql`${paymentDisputes.resolvedAt} is not null`), tc)),
  ]);
  const rate = last30dOrders > 0 ? Number(((last30dCount / last30dOrders) * 100).toFixed(2)) : 0;
  return { open, overdue, last30dCount, last30dRate: rate, avgResolveHours: Number(Number(resolvedRows[0]?.avgHours ?? 0).toFixed(1)) };
}

// ─── 智能分流（规则中心 dispute_triage 决策表，optional：未发布不影响工单创建）────

/** 分流约定表 key：发布即生效，输出 route/priority/slaHours；未命中或未发布走默认队列 */
const DISPUTE_TRIAGE_TABLE_KEY = 'dispute_triage';

/**
 * 新工单智能分流：组装事实（工单类型/金额 + 投诉人近90天投诉数）交决策表裁决，
 * 命中则写 route/priority/slaHours（SLA 同步收紧 deadline，只紧不松）并落 system 时间线。
 * 决策表输出是「建议」——auto_refund_suggest 仅在 UI 呈现徽标与预填退款，资金动作仍人工确认。
 */
export async function triageDispute(row: PaymentDisputeRow): Promise<void> {
  const complainant = row.complainant ?? '';
  const history90d = complainant
    ? await db.$count(paymentDisputes, and(
      eq(paymentDisputes.complainant, complainant),
      gte(paymentDisputes.createdAt, dayjs().subtract(90, 'day').toDate()),
      exactTenantCondition(paymentDisputes.tenantId, row.tenantId),
    ))
    : 0;
  const decision = await decide(
    { kind: 'table', key: DISPUTE_TRIAGE_TABLE_KEY },
    {
      dispute: { type: row.type, amount: row.amount },
      history: { disputeCount90d: history90d },
    },
    { caller: 'payment.dispute', tenantId: row.tenantId ?? null, bizRef: `payment:dispute:${row.disputeNo}` },
  );
  if (!decision.matched) return;
  const route = typeof decision.outputs.route === 'string' && decision.outputs.route ? decision.outputs.route : null;
  if (!route) return;
  const priority = Number.isFinite(Number(decision.outputs.priority)) ? Number(decision.outputs.priority) : null;
  const slaHours = Number.isFinite(Number(decision.outputs.slaHours)) && Number(decision.outputs.slaHours) > 0 ? Number(decision.outputs.slaHours) : null;
  const patch: Partial<typeof paymentDisputes.$inferInsert> = { route, priority, slaHours };
  // SLA 只收紧不放松：分流 deadline 早于默认时效才覆盖
  if (slaHours != null) {
    const slaDeadline = dayjs(row.createdAt).add(slaHours, 'hour').toDate();
    if (row.deadline == null || slaDeadline.getTime() < row.deadline.getTime()) patch.deadline = slaDeadline;
  }
  await db.update(paymentDisputes).set(patch).where(eq(paymentDisputes.id, row.id));
  const label = (PAYMENT_DISPUTE_ROUTE_LABELS as Record<string, string>)[route] ?? route;
  const bits = [`路由：${label}`];
  if (priority != null) bits.push(`优先级 ${priority}`);
  if (slaHours != null) bits.push(`SLA ${slaHours} 小时`);
  await appendReply(row.id, 'system', `智能分流（规则中心 ${DISPUTE_TRIAGE_TABLE_KEY} v${decision.ref.version ?? '-'}）：${bits.join(' · ')}`);
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

/** 投诉退款：复用支付中心退款（含大额审批链路），退款真正成功前工单保持处理中。 */
export async function refundDispute(id: number, input: RefundPaymentDisputeInput): Promise<PaymentDisputeDetail> {
  const row = await ensureDispute(id);
  if (!OPEN_STATUSES.includes(row.status)) throw new HTTPException(400, { message: '工单已完结' });
  if (row.refundNo) {
    const [existingRefund] = await db
      .select({ status: paymentRefunds.status })
      .from(paymentRefunds)
      .where(and(
        eq(paymentRefunds.refundNo, row.refundNo),
        exactTenantCondition(paymentRefunds.tenantId, row.tenantId),
      ))
      .limit(1);
    if (existingRefund?.status !== 'failed') {
      throw new HTTPException(400, { message: `该工单已有退款处理中（${row.refundNo}）` });
    }
  }
  const refundAmount = input.refundAmount ?? row.amount;
  if (refundAmount <= 0) throw new HTTPException(400, { message: '退款金额必须大于 0' });
  const res = await refund({
    orderNo: row.orderNo,
    refundAmount,
    reason: input.reason ?? `交易投诉退款（${row.disputeNo}）`,
    idempotencyKey: `dispute:${row.disputeNo}:${refundAmount}`,
    operatorId: currentUser().userId,
  });
  await appendReply(id, 'system', `已发起退款 ${res.refundNo}（${(refundAmount / 100).toFixed(2)} 元，状态：${res.status}）`, currentUser().userId);
  await db
    .update(paymentDisputes)
    .set({ refundNo: res.refundNo, status: 'processing', resolvedAt: null })
    .where(and(eq(paymentDisputes.id, id), inArray(paymentDisputes.status, OPEN_STATUSES)));
  if (res.status === 'success') await completeDisputeRefund(res.refundNo);
  return getDisputeDetail(id);
}

/** 退款成功事件的唯一终结入口；CAS 保证重复事件不会重复写时间线。 */
export async function completeDisputeRefund(refundNo: string): Promise<void> {
  const [updated] = await db
    .update(paymentDisputes)
    .set({ status: 'refunded', resolvedAt: new Date() })
    .where(and(eq(paymentDisputes.refundNo, refundNo), inArray(paymentDisputes.status, OPEN_STATUSES)))
    .returning({ id: paymentDisputes.id });
  if (!updated) return;
  await appendReply(updated.id, 'system', `退款 ${refundNo} 已成功，投诉工单自动完结`);
}

/** 退款失败仅追加说明并保持工单开放，允许人工核实后再次发起。 */
export async function recordDisputeRefundFailure(refundNo: string): Promise<void> {
  const [row] = await db
    .select({ id: paymentDisputes.id })
    .from(paymentDisputes)
    .where(and(eq(paymentDisputes.refundNo, refundNo), inArray(paymentDisputes.status, OPEN_STATUSES)))
    .limit(1);
  if (!row) return;
  await appendReply(row.id, 'system', `退款 ${refundNo} 未成功，工单保持处理中`);
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
      disputeNo: genPaymentNo('DSP'),
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
  // 智能分流（best-effort：决策表未发布/求值异常不阻断工单创建）
  try {
    await triageDispute(row);
  } catch (err) {
    logger.warn('[payment-dispute] triage failed', { disputeNo: row.disputeNo, error: err instanceof Error ? err.message : String(err) });
  }
  const [fresh] = await db.select().from(paymentDisputes).where(eq(paymentDisputes.id, row.id)).limit(1);
  return fresh ?? row;
}

/**
 * Cron：同步渠道投诉单。沙箱/演示模式下对近 7 天成功且未被投诉的订单生成模拟投诉
 * （未完结工单达到上限时跳过），真实渠道拉单需商户开通投诉 API 权限后扩展。
 * 模拟造数默认关闭，需显式设置 PAYMENT_MOCK_DISPUTES=true 开启（演示环境用）；
 * 手动「模拟投诉」按钮不受此开关限制。
 * 返回新增工单数。
 */
export async function syncPaymentDisputes(): Promise<number> {
  if (config.payment.engineMode !== 'sandbox') return 0;
  if (process.env.PAYMENT_MOCK_DISPUTES !== 'true') return 0;
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
  if (config.payment.engineMode !== 'sandbox') {
    throw new HTTPException(403, { message: '模拟投诉仅在支付沙箱模式开放' });
  }
  let order: { orderNo: string; channel: PaymentChannel; amount: number; openId: string | null; tenantId: number | null; sandbox: boolean } | undefined;
  const base = db
    .select({
      orderNo: paymentOrders.orderNo,
      channel: paymentOrders.channel,
      amount: paymentOrders.amount,
      openId: paymentOrders.openId,
      tenantId: paymentOrders.tenantId,
      sandbox: paymentChannelConfigs.sandbox,
    })
    .from(paymentOrders)
    .innerJoin(paymentChannelConfigs, eq(paymentChannelConfigs.id, paymentOrders.channelConfigId));
  const orderTenant = tenantCondition(paymentOrders, currentUser());
  const disputeTenant = tenantCondition(paymentDisputes, currentUser());
  if (orderNo) {
    [order] = await base.where(buildWhere(eq(paymentOrders.orderNo, orderNo), orderTenant)).limit(1);
    requireRow(order, '支付订单不存在');
    if (!order.sandbox) throw new HTTPException(400, { message: '仅沙箱商户订单可模拟投诉' });
    const dup = await db.$count(paymentDisputes, buildWhere(and(eq(paymentDisputes.orderNo, orderNo), inArray(paymentDisputes.status, OPEN_STATUSES)), disputeTenant));
    if (dup > 0) throw new HTTPException(400, { message: '该订单已存在未完结投诉' });
  } else {
    [order] = await base
      .where(buildWhere(and(
        eq(paymentOrders.status, 'success'),
        eq(paymentChannelConfigs.sandbox, true),
        sql`not exists (select 1 from ${paymentDisputes} where ${paymentDisputes.orderNo} = ${paymentOrders.orderNo})`,
      ), orderTenant))
      .orderBy(desc(paymentOrders.id))
      .limit(1);
    if (!order) throw new HTTPException(400, { message: '没有可用于模拟投诉的成功订单' });
  }
  return mapDispute(await createMockDispute(order));
}
