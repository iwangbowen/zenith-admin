import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowEventSubscriptions } from '../../db/schema';
import {
  findMatchingSubscriptions,
  insertDelivery,
  updateDeliveryAfterAttempt,
  computeNextRetryAt,
  findDeliveryById,
  findRetryableDeliveries,
} from '../../services/workflow-event-subscriptions.service';
import { workflowEventBus } from '../workflow-event-bus';
import { httpPost } from '../http-client';
import logger from '../logger';

const TIMEOUT_MS = 10_000;

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** 解析订阅自定义请求头 */
function parseHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, vv] of Object.entries(v)) if (typeof vv === 'string') out[k] = vv;
    return out;
  } catch {
    return {};
  }
}

export async function dispatchDelivery(deliveryId: number): Promise<void> {
  const delivery = await findDeliveryById(deliveryId);
  if (!delivery) return;

  const [sub] = await db.select().from(workflowEventSubscriptions).where(eq(workflowEventSubscriptions.id, delivery.subscriptionId)).limit(1);

  // 即使 sub 已被删除/禁用，也直接走基础信息走 fallback 用 delivery 表里的 requestUrl
  // 但首次投递时还没记录 requestUrl，必须依赖 sub。
  // 简化处理：sub 不存在则置为 failed。
  if (!sub) {
    await updateDeliveryAfterAttempt(deliveryId, {
      status: 'failed',
      errorMessage: '订阅已被删除或禁用',
      finishedAt: new Date(),
    });
    return;
  }

  const attempt = delivery.attempt + 1;
  const bodyStr = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Zenith-Event': delivery.eventType,
    'X-Zenith-Event-Id': delivery.eventId,
    'X-Zenith-Delivery-Id': String(delivery.id),
    'X-Zenith-Attempt': String(attempt),
    ...parseHeaders(sub.headers),
  };
  if (sub.signMode === 'hmacSha256' && sub.secret) {
    headers['X-Zenith-Signature'] = `t=${timestamp},v1=${sign(sub.secret, timestamp, bodyStr)}`;
  }

  const startedAt = new Date();
  await updateDeliveryAfterAttempt(deliveryId, {
    attempt,
    status: 'pending',
    requestUrl: sub.url,
    requestHeaders: JSON.stringify(headers),
    startedAt,
  });

  const t0 = Date.now();
  try {
    const resp = await httpPost(sub.url, bodyStr, { headers, timeout: TIMEOUT_MS });
    const durationMs = Date.now() - t0;
    const respText = await resp.text().catch(() => '');
    if (resp.ok) {
      await updateDeliveryAfterAttempt(deliveryId, {
        status: 'success',
        responseStatus: resp.status,
        responseBody: respText.slice(0, 4096),
        durationMs,
        finishedAt: new Date(),
        errorMessage: null,
        nextRetryAt: null,
      });
      return;
    }
    const nextRetryAt = computeNextRetryAt(attempt);
    await updateDeliveryAfterAttempt(deliveryId, {
      status: nextRetryAt ? 'retrying' : 'failed',
      responseStatus: resp.status,
      responseBody: respText.slice(0, 4096),
      durationMs,
      errorMessage: `HTTP ${resp.status}`,
      nextRetryAt,
      finishedAt: nextRetryAt ? null : new Date(),
    });
  } catch (err) {
    const durationMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const nextRetryAt = computeNextRetryAt(attempt);
    await updateDeliveryAfterAttempt(deliveryId, {
      status: nextRetryAt ? 'retrying' : 'failed',
      errorMessage: msg.slice(0, 1024),
      durationMs,
      nextRetryAt,
      finishedAt: nextRetryAt ? null : new Date(),
    });
  }
}

export function registerWebhookWorkflowSubscriber(): void {
  workflowEventBus.onAny(async (event) => {
    try {
      const subs = await findMatchingSubscriptions({
        definitionId: event.definitionId,
        eventType: event.type,
        tenantId: event.tenantId,
      });
      for (const sub of subs) {
        const delivery = await insertDelivery({
          subscriptionId: sub.id,
          instanceId: event.instanceId ?? null,
          taskId: 'task' in event ? event.task.id : null,
          eventId: event.eventId,
          eventType: event.type,
          payload: event,
          tenantId: event.tenantId,
        });
        queueMicrotask(() => {
          dispatchDelivery(delivery.id).catch((err) => {
            logger.error('[workflow-webhook] dispatch failed', { deliveryId: delivery.id, err });
          });
        });
      }
    } catch (err) {
      logger.error('[workflow-webhook] subscriber error', { eventId: event.eventId, err });
    }
  });
  logger.info('[workflow-webhook] subscriber registered');
}

/** 由 cron 调度调用：扫描到期重试任务并触发派发 */
export async function retryWorkflowEventDeliveries(): Promise<{ retried: number }> {
  const rows = await findRetryableDeliveries(100);
  for (const row of rows) {
    queueMicrotask(() => {
      dispatchDelivery(row.id).catch((err) => {
        logger.error('[workflow-webhook] retry dispatch failed', { deliveryId: row.id, err });
      });
    });
  }
  return { retried: rows.length };
}
