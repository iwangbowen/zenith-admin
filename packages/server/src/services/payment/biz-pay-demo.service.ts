/**
 * 业务接入示例：支付接入 Service
 *
 * 演示「业务模块如何对接支付中心」的标准三步：
 *   1) 业务自有实体落库（biz_pay_demos，状态 pending）；
 *   2) 发起支付：调用统一支付门面 createPayment（bizType='biz_pay_demo'），
 *      回填 paymentOrderNo 并置 paying，返回二维码 / 跳转链接给前端；
 *   3) 监听 paymentEventBus 'payment.succeeded'（见 biz-pay-demo-subscribers）按
 *      bizType 过滤后履约：markBizPayDemoPaid 幂等置 paid 并发放示例权益。
 *
 * 「模拟支付成功」为演示专用：
 * - 已发起支付（存在支付订单）时，调用支付中心运营接口 simulateOrderPaid 走与真实回调
 *   完全一致的 markOrderPaid 链路（状态机 → Outbox 事件 → 台账/手续费 → Webhook → 订阅器履约），
 *   保证业务侧与支付中心数据一致；
 * - 尚未发起支付时（无支付订单），仅执行本地履约演示业务闭环（不存在支付订单，无一致性问题）。
 */
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { BizPayDemo, BizPayDemoStatus } from '@zenith/shared/biz';
import type { PaymentMethod, PaymentCashierMethod, CreatePaymentResult } from '@zenith/shared/payment';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import { bizPayDemos, paymentOrders, type BizPayDemoRow } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { keywordCondition, buildWhere } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import logger from '../../lib/logger';
import { createPayment } from './payment.service';

/** 业务类型标识（与订阅器、支付门面 bizType 保持一致） */
export const BIZ_PAY_DEMO_TYPE = 'biz_pay_demo';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapBizPayDemo(row: BizPayDemoRow): BizPayDemo {
  return {
    id: row.id,
    subject: row.subject,
    amount: row.amount,
    payMethod: (row.payMethod ?? null) as PaymentMethod | null,
    status: row.status,
    paymentOrderNo: row.paymentOrderNo ?? null,
    paidAt: formatNullableDateTime(row.paidAt),
    fulfillRemark: row.fulfillRemark ?? null,
    tenantId: row.tenantId,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────

/** 仅本人可操作自己的示例单 */
function findOwn(id: number) {
  const user = currentUser();
  const conds: (SQL | undefined)[] = [eq(bizPayDemos.id, id), eq(bizPayDemos.createdBy, user.userId)];
  const tc = tenantCondition(bizPayDemos, user);
  conds.push(tc);
  return buildWhere(...conds);
}

async function getOwnRow(id: number): Promise<BizPayDemoRow> {
  const [row] = await db.select().from(bizPayDemos).where(findOwn(id)).limit(1);
  requireRow(row, '示例单不存在');
  return row;
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

export async function listBizPayDemos(query: { page?: number; pageSize?: number; keyword?: string; status?: string }) {
  const user = currentUser();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 10;
  const conds: (SQL | undefined)[] = [eq(bizPayDemos.createdBy, user.userId)];
  const tc = tenantCondition(bizPayDemos, user);
  conds.push(tc);
  if (query.status) conds.push(eq(bizPayDemos.status, query.status as BizPayDemoStatus));
  conds.push(keywordCondition(query.keyword, [bizPayDemos.subject]));
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(bizPayDemos, where),
    rows: () => db.select().from(bizPayDemos).where(where).orderBy(desc(bizPayDemos.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapBizPayDemo,
  });
}

export async function getBizPayDemo(id: number): Promise<BizPayDemo> {
  return mapBizPayDemo(await getOwnRow(id));
}

export async function createBizPayDemo(data: { subject: string; amount: number }): Promise<BizPayDemo> {
  const user = currentUser();
  const [row] = await db.insert(bizPayDemos).values({
    subject: data.subject,
    amount: data.amount,
    status: 'pending',
    tenantId: requireTenantScopeId(user),
  }).returning();
  return mapBizPayDemo(row);
}

export async function deleteBizPayDemo(id: number): Promise<void> {
  requireTenantScopeId(currentUser());
  const row = await getOwnRow(id);
  if (row.status === 'paid') throw new HTTPException(400, { message: '已支付的示例单不可删除' });
  await db.delete(bizPayDemos).where(eq(bizPayDemos.id, id));
}

/**
 * 发起支付：调用统一支付门面下单，回填支付单号并置 paying，返回支付参数。
 * 这一步是业务模块对接支付中心的核心：只需提供 bizType / bizId / 金额 / 支付方式。
 */
export async function payBizPayDemo(
  id: number,
  input: { applicationId: number; payMethod: PaymentCashierMethod; openId?: string },
  clientIp?: string,
): Promise<{ demo: BizPayDemo; payParams: CreatePaymentResult }> {
  requireTenantScopeId(currentUser());
  const row = await getOwnRow(id);
  if (row.status === 'paid') throw new HTTPException(400, { message: '该示例单已支付，无需重复发起' });

  let orderNo: string;
  let payParams: CreatePaymentResult;
  try {
    const res = await createPayment({
      bizType: BIZ_PAY_DEMO_TYPE,
      bizId: String(row.id),
      subject: row.subject,
      amount: row.amount,
      currency: 'CNY',
      applicationId: input.applicationId,
      payMethod: input.payMethod,
      openId: input.openId,
      expireMinutes: 30,
      clientIp,
      tenantId: row.tenantId,
    });
    orderNo = res.orderNo;
    payParams = res.payParams;
  } catch (err) {
    const msg = err instanceof HTTPException ? err.message : (err as Error)?.message ?? '未知错误';
    throw new HTTPException(400, {
      message: `发起支付失败（${msg}）`,
    });
  }

  await db.update(bizPayDemos)
    .set({ status: 'paying', payMethod: input.payMethod, paymentOrderNo: orderNo })
    .where(eq(bizPayDemos.id, row.id));

  return { demo: mapBizPayDemo({ ...row, status: 'paying', payMethod: input.payMethod, paymentOrderNo: orderNo }), payParams };
}

/**
 * 模拟支付成功（演示专用）。
 * 已存在支付订单时走支付中心完整模拟链路（与订单页「模拟支付」同一入口），
 * 由 payment.succeeded 事件订阅器完成履约；markBizPayDemoPaid 幂等兜底保证本次请求内即时可见。
 * 没有支付订单时拒绝模拟，避免业务状态绕过支付事实来源。
 */
export async function simulateBizPayDemoPaid(id: number): Promise<BizPayDemo> {
  requireTenantScopeId(currentUser());
  const row = await getOwnRow(id);
  if (row.status === 'paid') return mapBizPayDemo(row);
  if (row.status === 'closed') throw new HTTPException(400, { message: '已关闭的示例单无法支付' });
  if (!row.paymentOrderNo) {
    throw new HTTPException(400, { message: '请先通过支付应用创建支付订单，再模拟沙箱回调' });
  }
  const [maybeOrder] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderNo, row.paymentOrderNo)).limit(1);
  const order = requireRow(maybeOrder, '关联支付订单不存在', 409);
  if (order.status === 'pending' || order.status === 'paying') {
    const { simulateOrderPaid } = await import('./payment-ops.service');
    await simulateOrderPaid(order.id);
  } else if (order.status !== 'success') {
    throw new HTTPException(400, { message: `当前支付订单状态 ${order.status} 不可模拟成功` });
  }
  // 幂等兜底：订阅器异步履约可能尚未执行，此处复用同一履约函数保证响应内即时可见。
  await markBizPayDemoPaid({ bizId: String(row.id), orderNo: order.orderNo, amount: row.amount });
  return getBizPayDemo(id);
}

/**
 * 履约（幂等）：支付成功后置 paid 并发放示例权益。
 * 由订阅器在请求上下文之外调用，故不依赖 currentUser；按主键 + 状态条件保证幂等，
 * 仅当订单处于待支付/支付中（pending/paying）时才履约，重复投递（at-least-once）只生效一次。
 */
export async function markBizPayDemoPaid(event: { bizId: string; orderNo: string; amount: number; appId?: number | null; tenantId?: number | null }): Promise<void> {
  const demoId = Number(event.bizId);
  if (!Number.isInteger(demoId) || demoId <= 0) {
    logger.warn('[biz-pay-demo] 履约 bizId 非法', { bizId: event.bizId });
    return;
  }
  if (event.appId == null) return;
  const tenantScope = exactTenantCondition(paymentOrders.tenantId, event.tenantId ?? null);
  const [order] = await db
    .select({ id: paymentOrders.id, amount: paymentOrders.amount, paidAmount: paymentOrders.paidAmount })
    .from(paymentOrders)
    .where(and(
      eq(paymentOrders.orderNo, event.orderNo),
      eq(paymentOrders.bizType, BIZ_PAY_DEMO_TYPE),
      eq(paymentOrders.bizId, String(demoId)),
      eq(paymentOrders.appId, event.appId),
      eq(paymentOrders.status, 'success'),
      tenantScope,
    ))
    .limit(1);
  if (!order || (order.amount !== event.amount && order.paidAmount !== event.amount)) return;
  const demoTenant = exactTenantCondition(bizPayDemos.tenantId, event.tenantId ?? null);
  const updated = await db.update(bizPayDemos)
    .set({
      status: 'paid',
      paidAt: new Date(),
      paymentOrderNo: event.orderNo,
      fulfillRemark: '支付成功，已自动发放示例权益（演示履约）',
    })
    .where(and(eq(bizPayDemos.id, demoId), inArray(bizPayDemos.status, ['pending', 'paying']), demoTenant))
    .returning({ id: bizPayDemos.id });

  if (updated.length === 0) return; // 已履约 / 已关闭 / 不存在，幂等跳过
  logger.info('[biz-pay-demo] 履约完成', { demoId, orderNo: event.orderNo, amount: event.amount });
}
