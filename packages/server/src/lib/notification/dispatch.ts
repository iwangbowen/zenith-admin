/**
 * 通知派发引擎：把一条 outbox 事件展开成「收件人 × 渠道」的投递与留痕。
 *
 * 单个渠道失败不影响其他渠道，也不影响其他收件人——一次事件里有人邮箱写错，
 * 不应该让同一批的其他人都收不到。
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  getNotificationEvent,
  isNotificationEventKey,
  type NotificationChannel,
  type NotificationEventKey,
  type NotificationRecipient,
} from '@zenith/shared/messaging';
import { db } from '../../db';
import {
  notificationDispatches,
  notificationOutbox,
  notificationOutboxSubjects,
  type NewNotificationDispatch,
  type NotificationOutboxRow,
} from '../../db/schema';
import logger from '../logger';
import { createConcurrencyLimiter } from '../concurrency';
import { renderTemplate } from '../sms-sender';
import { getNotificationAdapter } from './registry';
import { resolveDispatchPlan, type ChannelResolution } from './resolver';
import { normalizeTemplateVars } from './template-vars';
import type { ResolvedRecipient } from './types';
import { exactTenantCondition } from '../tenant';

/**
 * 进程内同时在飞的渠道投递上限（跨 outbox 行、跨触发入口）。
 * 一行事件展开成「收件人 × 渠道」后不再无界并发：一次 300 人的群发不会同时打开 300 个 SMTP / HTTP 连接，
 * 定时补投与请求内立即派发叠加时总量也被钉在这里。数值按共享的数据库连接池（默认 20）与 SMTP 连接池（5）取。
 */
export const NOTIFICATION_DELIVERY_CONCURRENCY = 32;
const deliveryLimiter = createConcurrencyLimiter(NOTIFICATION_DELIVERY_CONCURRENCY);

export interface DeliverSummary {
  sent: number;
  suppressed: number;
  deferred: number;
  failed: number;
}

/** 收件人在留痕与去重中的稳定标识。 */
function recipientTag(recipient: NotificationRecipient): string {
  return recipient.type === 'external'
    ? `external:${recipient.channel}:${recipient.address}`
    : `${recipient.type}:${recipient.id}`;
}

function dispatchRowBase(row: NotificationOutboxRow, recipient: NotificationRecipient, channel: NotificationChannel) {
  return {
    outboxId: row.id,
    eventKey: row.eventKey,
    recipientType: recipient.type,
    recipientId: recipient.type === 'external' ? null : recipient.id,
    recipientAddress: recipient.type === 'external' ? recipient.address : null,
    channel,
    tenantId: row.tenantId,
    dedupeKey: row.dedupeKey ? `${row.dedupeKey}:${recipientTag(recipient)}:${channel}` : null,
  } satisfies Partial<NewNotificationDispatch>;
}

/**
 * 已成功投递的「收件人 × 渠道」集合。
 * outbox 行因为某个渠道失败而重试时，靠它避免给已经收到的人重复发送。
 */
async function loadAlreadySent(outboxId: number): Promise<Set<string>> {
  const rows = await db.select({
    recipientType: notificationDispatches.recipientType,
    recipientId: notificationDispatches.recipientId,
    recipientAddress: notificationDispatches.recipientAddress,
    channel: notificationDispatches.channel,
  }).from(notificationDispatches).where(and(
    eq(notificationDispatches.outboxId, outboxId),
    inArray(notificationDispatches.decision, ['sent', 'deduped']),
  ));
  return new Set(rows.map((r) => {
    const tag = r.recipientType === 'external'
      ? `external:${r.channel}:${r.recipientAddress ?? ''}`
      : `${r.recipientType}:${r.recipientId ?? ''}`;
    return `${tag}|${r.channel}`;
  }));
}

/**
 * 把命中免打扰 / 摘要的投递重新入队。
 * quiet 到点后逐条重投；digest 行带 digestKey，由聚合任务合并成一封摘要。
 */
async function enqueueDeferred(
  row: NotificationOutboxRow,
  deferrals: Array<{ recipient: NotificationRecipient; channel: NotificationChannel; deferUntil: Date; digestKey: string | null }>,
): Promise<void> {
  if (deferrals.length === 0) return;
  await db.transaction(async (tx) => {
    const subjects = await tx.select({ entityType: notificationOutboxSubjects.entityType, entityKey: notificationOutboxSubjects.entityKey, role: notificationOutboxSubjects.role })
      .from(notificationOutboxSubjects).where(and(eq(notificationOutboxSubjects.outboxId, row.id), exactTenantCondition(notificationOutboxSubjects.tenantId, row.tenantId)));
    const deferredRows = await tx.insert(notificationOutbox).values(deferrals.map((item) => ({
      eventKey: row.eventKey,
      recipients: [item.recipient],
      vars: row.eventKey === 'platform.entity.changed' && item.digestKey ? { ...row.vars, entityWatchDigestReady: true } : row.vars,
      channelPolicy: { only: [item.channel] },
      channelOptions: row.channelOptions,
      link: row.link,
      // Guarded notifications retain a per-window key so retrying their original row cannot multiply delayed copies.
      dedupeKey: row.eventKey === 'platform.entity.changed' && item.recipient.type === 'user'
        ? `entity-watch-deferred:${String(row.vars.eventId)}:${item.recipient.id}:${item.channel}:${Math.floor(item.deferUntil.getTime() / 60_000)}` : null,
      scheduledAt: item.deferUntil,
      digestKey: row.eventKey === 'platform.entity.changed' ? null : item.digestKey,
      traceId: row.traceId,
      parentRef: row.parentRef,
      tenantId: row.tenantId,
    }))).onConflictDoNothing({ target: notificationOutbox.dedupeKey, where: sql`${notificationOutbox.dedupeKey} is not null` }).returning({ id: notificationOutbox.id });
    if (subjects.length) await tx.insert(notificationOutboxSubjects).values(deferredRows.flatMap((deferred) => subjects.map((subject) => ({
      ...subject, outboxId: deferred.id, tenantId: row.tenantId,
    }))));
  });
}

/** 派发一条 outbox 事件。渠道级失败在这里被吸收并留痕，只有整体不可继续时才抛出。 */
export async function deliverOutboxRow(row: NotificationOutboxRow): Promise<DeliverSummary> {
  if (!isNotificationEventKey(row.eventKey)) {
    throw new Error(`未注册的通知事件：${row.eventKey}`);
  }
  const eventKey = row.eventKey as NotificationEventKey;
  const event = getNotificationEvent(eventKey);
  const vars = normalizeTemplateVars(row.vars ?? {});
  const title = renderTemplate(event.title, vars);
  const content = renderTemplate(event.content, vars);

  const [plan, alreadySent] = await Promise.all([
    resolveDispatchPlan({
      eventKey,
      event,
      recipients: row.recipients,
      tenantId: row.tenantId,
      policy: row.channelPolicy ?? null,
      digestWindowElapsed: row.eventKey === 'platform.entity.changed' && row.vars.entityWatchDigestReady === true
        && row.scheduledAt !== null && row.scheduledAt <= new Date(),
    }),
    loadAlreadySent(row.id),
  ]);

  const records: NewNotificationDispatch[] = [];
  const deferrals: Array<{ recipient: NotificationRecipient; channel: NotificationChannel; deferUntil: Date; digestKey: string | null }> = [];
  const summary: DeliverSummary = { sent: 0, suppressed: 0, deferred: 0, failed: 0 };

  const deliveries: Array<Promise<void>> = [];

  for (const { recipient, channels } of plan) {
    for (const resolution of channels) {
      const { channel } = resolution;
      if (alreadySent.has(`${recipientTag(recipient)}|${channel}`)) {
        summary.sent += 1;
        continue;
      }
      if (!resolution.allowed) {
        pushSuppressed(row, recipient, resolution, records, deferrals, summary);
        continue;
      }
      deliveries.push(deliveryLimiter.run(() => deliverOne(row, event, eventKey, recipient, resolution, title, content, vars, records, summary)));
    }
  }

  await Promise.all(deliveries);
  if (records.length > 0) {
    await db.insert(notificationDispatches).values(records).onConflictDoNothing({
      target: notificationDispatches.dedupeKey,
      where: sql`${notificationDispatches.dedupeKey} is not null`,
    });
  }
  await enqueueDeferred(row, deferrals);
  return summary;
}

function pushSuppressed(
  row: NotificationOutboxRow,
  recipient: NotificationRecipient,
  resolution: ChannelResolution,
  records: NewNotificationDispatch[],
  deferrals: Array<{ recipient: NotificationRecipient; channel: NotificationChannel; deferUntil: Date; digestKey: string | null }>,
  summary: DeliverSummary,
): void {
  const deferred = resolution.deferUntil !== null;
  records.push({
    ...dispatchRowBase(row, recipient, resolution.channel),
    decision: deferred ? 'deferred' : 'suppressed',
    reasonCode: resolution.reasonCode,
    reasonDetail: null,
  });
  if (deferred && resolution.deferUntil) {
    deferrals.push({
      recipient,
      channel: resolution.channel,
      deferUntil: resolution.deferUntil,
      // 同一收件人同一窗口共享一个 digestKey，聚合任务据此合并
      digestKey: resolution.deferKind === 'digest'
        ? `${recipientTag(recipient)}:${resolution.deferUntil.getTime()}`
        : null,
    });
    summary.deferred += 1;
  } else {
    summary.suppressed += 1;
  }
}

/**
 * 频控：窗口内已成功投递条数达到上限则抑制。仅在事件声明 rateLimit 时才查询。
 *
 * check-then-act 近似：本批次的 sent 记录在全部投递完成后才批量落库，
 * 并发突发时可能超出上限至多「突发条数」条，随后收敛。频控目标是止住风暴
 * 而非精确配额，这里刻意用近似换取免去逐条落库的写放大。
 */
async function isRateLimited(
  event: ReturnType<typeof getNotificationEvent>,
  base: ReturnType<typeof dispatchRowBase>,
): Promise<boolean> {
  if (!event.rateLimit) return false;
  const since = new Date(Date.now() - event.rateLimit.windowMinutes * 60_000);
  const recipientCondition = base.recipientId !== null
    ? and(eq(notificationDispatches.recipientType, base.recipientType), eq(notificationDispatches.recipientId, base.recipientId))
    : eq(notificationDispatches.recipientAddress, base.recipientAddress ?? '');
  const count = await db.$count(notificationDispatches, and(
    recipientCondition,
    eq(notificationDispatches.eventKey, base.eventKey),
    eq(notificationDispatches.channel, base.channel),
    eq(notificationDispatches.decision, 'sent'),
    gte(notificationDispatches.createdAt, since),
  ));
  return count >= event.rateLimit.limit;
}

async function deliverOne(
  row: NotificationOutboxRow,
  event: ReturnType<typeof getNotificationEvent>,
  eventKey: NotificationEventKey,
  recipient: NotificationRecipient,
  resolution: ChannelResolution,
  title: string,
  content: string,
  vars: Record<string, string>,
  records: NewNotificationDispatch[],
  summary: DeliverSummary,
): Promise<void> {
  const { channel } = resolution;
  const base = dispatchRowBase(row, recipient, channel);
  const adapter = getNotificationAdapter(channel);
  if (!adapter) {
    records.push({ ...base, decision: 'suppressed', reasonCode: 'channel_unavailable', reasonDetail: null });
    summary.suppressed += 1;
    return;
  }

  if (await isRateLimited(event, base)) {
    records.push({ ...base, decision: 'suppressed', reasonCode: 'rate_limited', reasonDetail: null });
    summary.suppressed += 1;
    return;
  }

  let address: string | null;
  const deliveryOptions = row.eventKey === 'platform.entity.changed' ? null : row.channelOptions ?? null;
  try {
    address = await adapter.resolveAddress(recipient, deliveryOptions);
  } catch (err) {
    records.push({
      ...base,
      decision: 'failed',
      reasonCode: 'delivery_error',
      reasonDetail: describeError(err),
    });
    summary.failed += 1;
    return;
  }

  if (!address) {
    // 「没绑邮箱」不是故障，不该计入失败重试，否则每次重投都会再失败一次
    records.push({ ...base, decision: 'suppressed', reasonCode: 'unreachable', reasonDetail: null });
    summary.suppressed += 1;
    return;
  }

  const target: ResolvedRecipient = {
    recipient,
    address,
    subjectId: recipient.type === 'external' ? null : recipient.id,
  };

  let deliveryTitle = title;
  let deliveryContent = content;
  let deliveryVars = vars;
  let deliveryLink = row.link;
  if (row.eventKey === 'platform.entity.changed') {
    const { authorizeEntityWatchDelivery } = await import('../../services/platform/entity-watch-delivery-guard');
    const authorized = await authorizeEntityWatchDelivery(row, recipient);
    if (!authorized) {
      records.push({ ...base, decision: 'suppressed', reasonCode: 'source_unavailable', reasonDetail: null });
      summary.suppressed += 1;
      return;
    }
    deliveryVars = normalizeTemplateVars(authorized.vars);
    deliveryTitle = renderTemplate(event.title, deliveryVars);
    deliveryContent = renderTemplate(event.content, deliveryVars);
    deliveryLink = authorized.link;
  }
  try {
    const result = await adapter.send({
      eventKey,
      event,
      target,
      title: deliveryTitle,
      content: deliveryContent,
      vars: deliveryVars,
      link: deliveryLink,
      tenantId: row.tenantId,
      dedupeKey: base.dedupeKey,
      channelLocked: resolution.locked === true,
      options: deliveryOptions,
    });
    records.push({ ...base, decision: 'sent', reasonCode: null, reasonDetail: null, providerMsgId: result.providerMsgId ?? null });
    summary.sent += 1;
  } catch (err) {
    const detail = describeError(err);
    logger.warn('[notification] 渠道投递失败', { eventKey, channel, recipient: recipientTag(recipient), detail });
    records.push({ ...base, decision: 'failed', reasonCode: 'delivery_error', reasonDetail: detail });
    summary.failed += 1;
  }
}

function describeError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}
