/**
 * 支付异常收口：渠道已发生但本地无法按正常状态机推进的事实。
 *
 * 当前覆盖：
 * - late_payment：订单已 closed/failed/unknown 终态后渠道再确认支付成功；
 * - amount_mismatch：回调/查单金额与订单不一致（由调用方记录）。
 *
 * 异常只落库、不自动改单；运营人员通过异常中心决定确认入账、原路退款或挂账。
 */
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import { paymentExceptionSchema, paymentOpsContract, type PaymentException } from '@zenith/shared/payment';
import { db } from '../../db';
import { paymentExceptions, type PaymentExceptionRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { listRows } from '../../lib/list-query';
import { pickEntity } from '../../lib/entity-map';

export interface RecordPaymentExceptionInput {
  type: 'late_payment' | 'amount_mismatch' | 'refund_unknown' | 'provider_error';
  orderNo?: string | null;
  refundNo?: string | null;
  channel?: 'wechat' | 'alipay' | 'unionpay' | null;
  channelConfigId?: number | null;
  appId?: number | null;
  amount?: number | null;
  currency?: string | null;
  message?: string | null;
  payload?: unknown;
  tenantId: number | null;
}

function exceptionDedupeKey(input: RecordPaymentExceptionInput): string {
  const canonical = JSON.stringify({
    type: input.type,
    orderNo: input.orderNo ?? null,
    refundNo: input.refundNo ?? null,
    channelConfigId: input.channelConfigId ?? null,
    amount: input.amount ?? null,
    message: input.message ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** 记录异常；同一事实重复回调不会重复落案。 */
export async function recordPaymentException(input: RecordPaymentExceptionInput): Promise<void> {
  await db
    .insert(paymentExceptions)
    .values({
      type: input.type,
      dedupeKey: exceptionDedupeKey(input),
      orderNo: input.orderNo ?? null,
      refundNo: input.refundNo ?? null,
      channel: input.channel ?? null,
      channelConfigId: input.channelConfigId ?? null,
      appId: input.appId ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      message: input.message?.slice(0, 500) ?? null,
      payload: input.payload == null ? null : input.payload,
      tenantId: input.tenantId,
    })
    .onConflictDoNothing({ target: paymentExceptions.dedupeKey });
}

export type PaymentExceptionListQuery = QueryOutputOf<typeof paymentOpsContract.exceptions>;

export function mapPaymentException(row: PaymentExceptionRow): PaymentException {
  return pickEntity(paymentExceptionSchema, row, {
    type: row.type as PaymentException['type'],
    payload: row.payload as Record<string, unknown> | null,
  });
}

export async function listPaymentExceptions(q: PaymentExceptionListQuery) {
  const where = buildWhere(
    keywordCondition(q.keyword, [paymentExceptions.orderNo, paymentExceptions.refundNo, paymentExceptions.message]),
    q.status ? eq(paymentExceptions.status, q.status) : undefined,
    q.type ? eq(paymentExceptions.type, q.type) : undefined,
    ...dateRangeConditions(paymentExceptions.createdAt, q.startTime, q.endTime),
    tenantCondition(paymentExceptions, currentUser()),
  );
  return listRows({
    page: q.page,
    pageSize: q.pageSize,
    table: paymentExceptions,
    where,
    orderBy: [desc(paymentExceptions.id)],
    map: mapPaymentException,
  });
}

export async function ensurePaymentException(id: number): Promise<PaymentExceptionRow> {
  const [row] = await db
    .select()
    .from(paymentExceptions)
    .where(and(eq(paymentExceptions.id, id), tenantCondition(paymentExceptions, currentUser())))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '支付异常记录不存在' });
  return row;
}

/** 标记异常已处理/忽略；真正的资金动作仍由退款/补账等既有流程执行。 */
export async function resolvePaymentException(
  id: number,
  action: 'resolve' | 'ignore',
  remark?: string,
): Promise<PaymentException> {
  const user = currentUser();
  requireTenantScopeId(user);
  const row = await ensurePaymentException(id);
  if (row.status !== 'open') return mapPaymentException(row);
  const [updated] = await db
    .update(paymentExceptions)
    .set({
      status: action === 'resolve' ? 'resolved' : 'ignored',
      resolvedAt: new Date(),
      resolvedBy: user.userId,
      message: remark?.trim() || row.message,
    })
    .where(and(eq(paymentExceptions.id, id), eq(paymentExceptions.status, 'open'), tenantCondition(paymentExceptions, user)))
    .returning();
  return mapPaymentException(updated ?? row);
}
