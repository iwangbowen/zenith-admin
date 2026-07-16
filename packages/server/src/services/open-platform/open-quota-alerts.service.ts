import { randomUUID } from 'node:crypto';
import { and, eq, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { oauth2Clients, openQuotaAlerts, users, type OpenQuotaAlertRow } from '../../db/schema';
import logger from '../../lib/logger';
import { openEventBus } from '../../lib/open-event-bus';
import { mapWithConcurrency } from '../../lib/concurrency';
import { sendSystemInApp } from '../messaging/in-app-messages.service';
import redis from '../../lib/redis';
import { config } from '../../config';

const CLAIM_TIMEOUT_MS = 5 * 60_000;
const DELIVERY_CONCURRENCY = 5;

async function claimQuotaAlert(id: number): Promise<OpenQuotaAlertRow | null> {
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const [row] = await db.update(openQuotaAlerts).set({
    status: 'processing',
    attempt: sql`${openQuotaAlerts.attempt} + 1`,
    startedAt: new Date(),
  }).where(and(
    eq(openQuotaAlerts.id, id),
    or(
      eq(openQuotaAlerts.status, 'pending'),
      and(eq(openQuotaAlerts.status, 'processing'), lte(openQuotaAlerts.startedAt, staleBefore)),
    ),
  )).returning();
  return row ?? null;
}

async function deliverQuotaAlert(id: number): Promise<boolean> {
  const alert = await claimQuotaAlert(id);
  if (!alert) return false;
  const percentage = Math.round((alert.used / alert.quotaLimit) * 10_000) / 100;
  try {
    await openEventBus.emitAndWait({
      type: 'app.quota.warning',
      clientId: alert.clientId,
      eventId: alert.eventId,
      data: {
        dimension: alert.dimension,
        used: alert.used,
        limit: alert.quotaLimit,
        percentage,
        threshold: alert.threshold,
        plan: alert.planCode,
      },
    });

    const [owner] = await db.select({
      userId: oauth2Clients.ownerId,
      appName: oauth2Clients.name,
      tenantId: users.tenantId,
    }).from(oauth2Clients)
      .leftJoin(users, eq(oauth2Clients.ownerId, users.id))
      .where(eq(oauth2Clients.clientId, alert.clientId))
      .limit(1);
    if (owner?.userId) {
      await sendSystemInApp({
        userIds: [owner.userId],
        title: `开放 API 配额已使用 ${alert.threshold}%`,
        content: `应用「${owner.appName}」${alert.dimension === 'daily' ? '每日' : '每月'}配额已使用 ${alert.used}/${alert.quotaLimit}，请关注剩余额度。`,
        type: alert.threshold >= 95 ? 'error' : 'warning',
        tenantId: owner.tenantId,
        dedupeKey: `open-quota:${alert.eventId}`,
      });
    }

    const completed = await db.update(openQuotaAlerts).set({
      status: 'sent',
      sentAt: new Date(),
      lastError: null,
    }).where(and(
      eq(openQuotaAlerts.id, alert.id),
      eq(openQuotaAlerts.status, 'processing'),
      eq(openQuotaAlerts.attempt, alert.attempt),
    )).returning({ id: openQuotaAlerts.id });
    return completed.length > 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(openQuotaAlerts).set({
      status: 'pending',
      lastError: message.slice(0, 1024),
    }).where(and(
      eq(openQuotaAlerts.id, alert.id),
      eq(openQuotaAlerts.status, 'processing'),
      eq(openQuotaAlerts.attempt, alert.attempt),
    ));
    throw err;
  }
}

export async function maybeSendQuotaWarning(input: {
  clientId: string;
  dimension: 'daily' | 'monthly';
  period: string;
  used: number;
  limit: number;
  planCode: string;
  gateTtlSeconds: number;
}): Promise<void> {
  if (input.limit <= 0) return;
  const percentage = (input.used / input.limit) * 100;
  const threshold = percentage >= 95 ? 95 : percentage >= 80 ? 80 : null;
  if (!threshold) return;

  const gateKey = `${config.redis.keyPrefix}openquota-gate:${input.clientId}:${input.dimension}:${input.period}:${threshold}`;
  const acquired = await redis.set(gateKey, '1', 'EX', 30, 'NX');
  if (acquired === null) return;
  let durable = false;
  try {
    const [row] = await db.insert(openQuotaAlerts).values({
      clientId: input.clientId,
      dimension: input.dimension,
      period: input.period,
      threshold,
      used: input.used,
      quotaLimit: input.limit,
      planCode: input.planCode,
      eventId: randomUUID(),
    }).onConflictDoNothing({
      target: [
        openQuotaAlerts.clientId,
        openQuotaAlerts.dimension,
        openQuotaAlerts.period,
        openQuotaAlerts.threshold,
      ],
    }).returning();
    durable = true;
    await redis.expire(gateKey, input.gateTtlSeconds);
    if (row) await deliverQuotaAlert(row.id);
  } catch (err) {
    if (!durable) {
      await redis.del(gateKey).catch((deleteErr) => logger.warn(
        '[open-gateway] quota gate release failed',
        { gateKey, err: deleteErr },
      ));
    }
    throw err;
  }
}

export async function retryPendingQuotaAlerts(): Promise<{ delivered: number }> {
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const rows = await db.select({ id: openQuotaAlerts.id }).from(openQuotaAlerts)
    .where(or(
      eq(openQuotaAlerts.status, 'pending'),
      and(eq(openQuotaAlerts.status, 'processing'), lte(openQuotaAlerts.startedAt, staleBefore)),
    ))
    .limit(100);
  const results = await mapWithConcurrency(rows, DELIVERY_CONCURRENCY, async ({ id }) => {
    try {
      return await deliverQuotaAlert(id);
    } catch (err) {
      logger.error('[open-gateway] quota alert retry failed', { alertId: id, err });
      return false;
    }
  });
  return { delivered: results.filter(Boolean).length };
}
