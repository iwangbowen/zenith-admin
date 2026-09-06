import { randomBytes } from 'node:crypto';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  CreatePaymentResult,
  PaymentCashierMethod,
  PaymentCashierSession,
  PaymentCashierSessionStatus,
} from '@zenith/shared/payment';
import { config } from '../../config';
import { db } from '../../db';
import { exactTenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import {
  paymentCashierSessions,
  paymentLinks,
  paymentOrders,
  type PaymentCashierSessionRow,
  type PaymentLinkRow,
  type PaymentOrderRow,
} from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import type { PaymentEvent } from '../../lib/payment-event-bus';
import logger from '../../lib/logger';
import { syncOrderStatus } from './payment.service';

function mapCashierSession(row: PaymentCashierSessionRow): PaymentCashierSession {
  return {
    sessionToken: row.sessionToken,
    linkId: row.linkId,
    appId: row.appId,
    orderNo: row.orderNo ?? null,
    payMethod: row.payMethod as PaymentCashierMethod,
    amount: row.amount,
    status: row.status,
    useSlotStatus: row.useSlotStatus,
    payParams: row.payParams ?? null,
    returnUrl: row.returnUrl,
    errorMessage: row.errorMessage ?? null,
    expiresAt: formatDateTime(row.expiresAt),
    version: row.version,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function cashierReturnUrl(linkToken: string, sessionToken: string): string {
  const url = new URL(`/public/payment/link/${encodeURIComponent(linkToken)}`, `${config.payment.cashierBaseUrl}/`);
  url.searchParams.set('session', sessionToken);
  return url.toString();
}

function sessionStatusFromOrder(order: PaymentOrderRow): PaymentCashierSessionStatus {
  if (order.status === 'success' || order.status === 'refunding' || order.status === 'refunded') return 'succeeded';
  if (order.status === 'unknown') return 'unknown';
  if (order.status === 'failed' || order.status === 'closed') return 'failed';
  if (order.status === 'paying') return 'processing';
  return 'awaiting';
}

export function buildCashierSessionExpiry(link: PaymentLinkRow): Date {
  const defaultExpiry = new Date(Date.now() + 30 * 60_000);
  return link.expiredAt && link.expiredAt < defaultExpiry ? link.expiredAt : defaultExpiry;
}

export async function createCashierSession(input: {
  link: PaymentLinkRow;
  linkToken: string;
  payMethod: PaymentCashierMethod;
  amount: number;
  expiresAt: Date;
}): Promise<PaymentCashierSessionRow> {
  const sessionToken = randomBytes(32).toString('base64url');
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(paymentLinks)
      .where(eq(paymentLinks.id, input.link.id))
      .for('update')
      .limit(1);
    if (!link || link.token !== input.linkToken) throw new HTTPException(404, { message: '支付链接不存在或已失效' });

    const released = await tx
      .update(paymentCashierSessions)
      .set({
        status: 'expired',
        useSlotStatus: 'released',
        errorMessage: '收银台会话已过期',
        version: sql`${paymentCashierSessions.version} + 1`,
      })
      .where(and(
        eq(paymentCashierSessions.linkId, link.id),
        eq(paymentCashierSessions.useSlotStatus, 'reserved'),
        // Do not release a slot for an in-flight/unknown provider call. The
        // payment may still settle after the session expiry and must retain
        // its reserved usage until the authoritative event arrives.
        inArray(paymentCashierSessions.status, ['ready', 'creating', 'awaiting']),
        lte(paymentCashierSessions.expiresAt, new Date()),
      ))
      .returning({ id: paymentCashierSessions.id });
    const reservedCount = Math.max(0, link.reservedCount - released.length);
    if (released.length > 0) {
      await tx.update(paymentLinks).set({ reservedCount }).where(eq(paymentLinks.id, link.id));
    }

    if (link.status !== 'active') throw new HTTPException(400, { message: '该支付链接已停用' });
    if (link.expiredAt && link.expiredAt <= new Date()) throw new HTTPException(400, { message: '该支付链接已过期' });
    if (link.payMethod && link.payMethod !== input.payMethod) throw new HTTPException(400, { message: '支付方式与链接固定方式不一致' });
    const consumesUseSlot = link.maxUses != null;
    if (link.maxUses != null && link.usedCount + reservedCount >= link.maxUses) {
      throw new HTTPException(409, { message: '该支付链接使用名额已满' });
    }
    if (consumesUseSlot) {
      await tx
        .update(paymentLinks)
        .set({ reservedCount: reservedCount + 1 })
        .where(eq(paymentLinks.id, link.id));
    }
    const [row] = await tx.insert(paymentCashierSessions).values({
      sessionToken,
      linkId: link.id,
      appId: link.appId,
      payMethod: input.payMethod,
      amount: input.amount,
      status: 'creating',
      useSlotStatus: consumesUseSlot ? 'reserved' : 'none',
      returnUrl: cashierReturnUrl(input.linkToken, sessionToken),
      expiresAt: input.expiresAt,
      tenantId: link.tenantId,
    }).returning();
    return row;
  });
}

async function setTerminalSessionState(input: {
  id: number;
  status: 'failed' | 'expired';
  errorMessage: string;
  expectedVersion?: number;
  allowedStatuses?: PaymentCashierSessionStatus[];
}): Promise<PaymentCashierSessionRow> {
  const [candidate] = await db
    .select({ linkId: paymentCashierSessions.linkId })
    .from(paymentCashierSessions)
    .where(eq(paymentCashierSessions.id, input.id))
    .limit(1);
  requireRow(candidate, '收银台会话不存在');

  return db.transaction(async (tx) => {
    // All link/session transactions lock the parent link first. Keeping one
    // order prevents expiry/failure and payment-success redemption from
    // deadlocking each other under concurrent provider callbacks.
    await tx
      .select({ id: paymentLinks.id })
      .from(paymentLinks)
      .where(eq(paymentLinks.id, candidate.linkId))
      .for('update')
      .limit(1);
    const [session] = await tx
      .select()
      .from(paymentCashierSessions)
      .where(eq(paymentCashierSessions.id, input.id))
      .for('update')
      .limit(1);
    requireRow(session, '收银台会话不存在');
    if ((input.expectedVersion !== undefined && session.version !== input.expectedVersion)
      || (input.allowedStatuses && !input.allowedStatuses.includes(session.status))) return session;
    if (session.useSlotStatus === 'reserved') {
      await tx
        .update(paymentLinks)
        .set({ reservedCount: sql`greatest(${paymentLinks.reservedCount} - 1, 0)` })
        .where(eq(paymentLinks.id, session.linkId));
    }
    const [updated] = await tx
      .update(paymentCashierSessions)
      .set({
        status: input.status,
        useSlotStatus: session.useSlotStatus === 'reserved' ? 'released' : session.useSlotStatus,
        errorMessage: input.errorMessage.slice(0, 500),
        version: sql`${paymentCashierSessions.version} + 1`,
      })
      .where(eq(paymentCashierSessions.id, session.id))
      .returning();
    return updated ?? session;
  });
}

/** 回收指定链接已过期但仍占用的名额；可由公开查询和后台任务调用。 */
export async function releaseExpiredCashierUseSlots(linkId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const [link] = await tx.select({ id: paymentLinks.id, reservedCount: paymentLinks.reservedCount })
      .from(paymentLinks)
      .where(eq(paymentLinks.id, linkId))
      .for('update')
      .limit(1);
    if (!link) return 0;
    const released = await tx.update(paymentCashierSessions)
      .set({
        status: 'expired',
        useSlotStatus: 'released',
        errorMessage: '收银台会话已过期',
        version: sql`${paymentCashierSessions.version} + 1`,
      })
      .where(and(
        eq(paymentCashierSessions.linkId, linkId),
        eq(paymentCashierSessions.useSlotStatus, 'reserved'),
        // In-flight/unknown provider calls retain their reserved slot until an
        // authoritative success/failure event arrives.
        inArray(paymentCashierSessions.status, ['ready', 'creating', 'awaiting']),
        lte(paymentCashierSessions.expiresAt, new Date()),
      ))
      .returning({ id: paymentCashierSessions.id });
    if (released.length > 0) {
      await tx.update(paymentLinks)
        .set({ reservedCount: Math.max(0, link.reservedCount - released.length) })
        .where(eq(paymentLinks.id, linkId));
    }
    return released.length;
  });
}

export async function bindCashierSession(input: {
  session: PaymentCashierSessionRow;
  order: PaymentOrderRow;
  payParams?: CreatePaymentResult | null;
}): Promise<PaymentCashierSession> {
  const status = sessionStatusFromOrder(input.order);
  const [updated] = await db
    .update(paymentCashierSessions)
    .set({
      orderNo: input.order.orderNo,
      payParams: input.payParams ?? input.session.payParams,
      status,
      errorMessage: input.order.errorMessage,
      version: sql`${paymentCashierSessions.version} + 1`,
    })
    .where(and(
      eq(paymentCashierSessions.id, input.session.id),
      eq(paymentCashierSessions.version, input.session.version),
      inArray(paymentCashierSessions.status, ['ready', 'creating', 'awaiting', 'processing', 'unknown']),
    ))
    .returning();
  if (updated) return mapCashierSession(updated);
  const [latest] = await db.select().from(paymentCashierSessions).where(eq(paymentCashierSessions.id, input.session.id)).limit(1);
  if (!latest) throw new HTTPException(409, { message: '收银台会话已失效' });
  return mapCashierSession(latest);
}

export async function failCashierSession(session: PaymentCashierSessionRow, error: unknown): Promise<PaymentCashierSession> {
  return mapCashierSession(await setTerminalSessionState({
    id: session.id,
    status: 'failed',
    errorMessage: error instanceof Error ? error.message : '创建支付失败',
    expectedVersion: session.version,
    allowedStatuses: ['ready', 'creating'],
  }));
}

export async function bindCashierSessionAfterCreateFailure(input: {
  session: PaymentCashierSessionRow;
  order: PaymentOrderRow;
  error: unknown;
}): Promise<PaymentCashierSession> {
  const derived = sessionStatusFromOrder(input.order);
  const status: PaymentCashierSessionStatus = derived === 'unknown' || derived === 'succeeded' ? derived : 'failed';
  if (status === 'failed') {
    return mapCashierSession(await setTerminalSessionState({
      id: input.session.id,
      status: 'failed',
      errorMessage: input.error instanceof Error ? input.error.message : input.order.errorMessage ?? '创建支付失败',
      expectedVersion: input.session.version,
      allowedStatuses: ['ready', 'creating'],
    }));
  }
  const [updated] = await db
    .update(paymentCashierSessions)
    .set({
      orderNo: input.order.orderNo,
      status,
      errorMessage: (input.error instanceof Error ? input.error.message : input.order.errorMessage ?? '创建支付失败').slice(0, 500),
      version: sql`${paymentCashierSessions.version} + 1`,
    })
    .where(and(
      eq(paymentCashierSessions.id, input.session.id),
      eq(paymentCashierSessions.version, input.session.version),
      inArray(paymentCashierSessions.status, ['ready', 'creating']),
    ))
    .returning();
  if (updated) return mapCashierSession(updated);
  const [latest] = await db.select().from(paymentCashierSessions).where(eq(paymentCashierSessions.id, input.session.id)).limit(1);
  return mapCashierSession(latest ?? input.session);
}

async function updateSessionFromOrder(session: PaymentCashierSessionRow, order: PaymentOrderRow): Promise<PaymentCashierSessionRow> {
  let status = sessionStatusFromOrder(order);
  const providerOutcomeUncertain = status === 'processing' || status === 'unknown'
    || session.status === 'processing' || session.status === 'unknown';
  if (!['succeeded', 'failed'].includes(status) && !providerOutcomeUncertain && session.expiresAt <= new Date()) status = 'expired';
  if (status === 'failed' || status === 'expired') {
    return setTerminalSessionState({
      id: session.id,
      status,
      errorMessage: order.errorMessage ?? (status === 'expired' ? '收银台会话已过期' : '支付未完成'),
      expectedVersion: session.version,
    });
  }
  if (session.status === status && session.orderNo === order.orderNo) return session;
  const [updated] = await db
    .update(paymentCashierSessions)
    .set({
      orderNo: order.orderNo,
      status,
      errorMessage: order.errorMessage,
      version: sql`${paymentCashierSessions.version} + 1`,
    })
    .where(and(eq(paymentCashierSessions.id, session.id), eq(paymentCashierSessions.version, session.version)))
    .returning();
  return updated ?? session;
}

export async function getPublicCashierSession(linkToken: string, sessionToken: string): Promise<PaymentCashierSession> {
  const [joined] = await db
    .select({ session: paymentCashierSessions })
    .from(paymentCashierSessions)
    .innerJoin(paymentLinks, eq(paymentLinks.id, paymentCashierSessions.linkId))
    .where(and(eq(paymentLinks.token, linkToken), eq(paymentCashierSessions.sessionToken, sessionToken)))
    .limit(1);
  requireRow(joined, '收银台会话不存在或已失效');
  let session = joined.session;
  if (session.status === 'succeeded') {
    // A delayed success callback can arrive after an expiry job released the
    // usage slot. Reconcile the redemption from the authoritative order even
    // when the session already looks terminal to the public client.
    if (session.orderNo) {
      const tenantScope = exactTenantCondition(paymentOrders.tenantId, session.tenantId);
      const [order] = await db.select().from(paymentOrders).where(and(
        eq(paymentOrders.orderNo, session.orderNo),
        eq(paymentOrders.appId, session.appId),
        tenantScope,
      )).limit(1);
      if (order && ['success', 'refunding', 'refunded'].includes(order.status)) {
        const { recordPaymentLinkRedemption } = await import('./payment-link.service');
        await recordPaymentLinkRedemption({
          orderNo: order.orderNo,
          bizType: order.bizType,
          bizId: order.bizId,
          appId: order.appId,
          tenantId: order.tenantId,
        });
        const [latest] = await db.select().from(paymentCashierSessions).where(eq(paymentCashierSessions.id, session.id)).limit(1);
        if (latest) session = latest;
      }
    }
    return mapCashierSession(session);
  }
  if (session.status === 'failed') {
    if (session.useSlotStatus !== 'reserved') return mapCashierSession(session);
    return mapCashierSession(await setTerminalSessionState({ id: session.id, status: 'failed', errorMessage: session.errorMessage ?? '支付未完成' }));
  }
  if (session.orderNo) {
    const tenantScope = exactTenantCondition(paymentOrders.tenantId, session.tenantId);
    const [order] = await db
      .select()
      .from(paymentOrders)
      .where(and(
        eq(paymentOrders.orderNo, session.orderNo),
        eq(paymentOrders.appId, session.appId),
        tenantScope,
      ))
      .limit(1);
    if (order) {
      let synchronized = order;
      if (!['success', 'refunded', 'closed', 'failed'].includes(order.status)) {
        try {
          synchronized = await syncOrderStatus(order);
        } catch (err) {
          logger.warn('[payment-cashier] synchronize order failed', { orderNo: order.orderNo, err });
        }
      }
      session = await updateSessionFromOrder(session, synchronized);
    }
  } else if (session.expiresAt <= new Date() && !['succeeded', 'failed', 'expired'].includes(session.status)) {
    session = await setTerminalSessionState({ id: session.id, status: 'expired', errorMessage: '收银台会话已过期', expectedVersion: session.version });
  }
  return mapCashierSession(session);
}

export async function updateCashierSessionFromPaymentEvent(
  event: PaymentEvent,
  status: 'succeeded' | 'failed',
): Promise<void> {
  if (event.appId == null) return;
  const tenantScope = exactTenantCondition(paymentCashierSessions.tenantId, event.tenantId ?? null);
  const [session] = await db
    .select()
    .from(paymentCashierSessions)
    .where(and(
      eq(paymentCashierSessions.orderNo, event.orderNo),
      eq(paymentCashierSessions.appId, event.appId),
      tenantScope,
    ))
    .limit(1);
  if (!session) return;
  if (status === 'failed') {
    if (!['ready', 'creating', 'awaiting', 'processing', 'unknown'].includes(session.status)) return;
    await setTerminalSessionState({ id: session.id, status: 'failed', errorMessage: '支付未完成' });
    return;
  }
  if (session.status === 'succeeded') {
    const { recordPaymentLinkRedemption } = await import('./payment-link.service');
    await recordPaymentLinkRedemption({
      orderNo: event.orderNo,
      bizType: event.bizType,
      bizId: event.bizId,
      appId: event.appId,
      tenantId: event.tenantId,
    });
    return;
  }
  await db
    .update(paymentCashierSessions)
    .set({ status: 'succeeded', errorMessage: null, version: sql`${paymentCashierSessions.version} + 1` })
    .where(and(eq(paymentCashierSessions.id, session.id), eq(paymentCashierSessions.version, session.version)));
  const { recordPaymentLinkRedemption } = await import('./payment-link.service');
  await recordPaymentLinkRedemption({
    orderNo: event.orderNo,
    bizType: event.bizType,
    bizId: event.bizId,
    appId: event.appId,
    tenantId: event.tenantId,
  });
}
