/**
 * 告警通知派发层（监控告警 / 错误告警）。
 *
 * 这里不再自己拼渠道，而是把告警规则翻译成一次通知中心事件：
 * 规则上配置的 channels 作为「管理员渠道策略」，接收人（系统用户 + 外部邮箱 + Webhook 地址）
 * 作为收件人集合，其余的幂等、留痕与失败隔离全部复用统一派发链路。
 *
 * 之所以仍然同步等待派发结果，是因为告警列表要展示「有没有真的通知到人」——
 * 只返回「已入队」的话，渠道配错在界面上就完全看不出来了。
 */
import { uniquePositiveInts } from '@zenith/shared/core';
import { eq, inArray, or, type SQL } from 'drizzle-orm';
import type {
  InAppMessageType,
  NotificationChannel,
  NotificationEventKey,
  NotificationEventVars,
  NotificationRecipient,
} from '@zenith/shared/messaging';
import type { MonitorAlertNotifyStatus } from '@zenith/shared/platform';
import { db } from '../db';
import { notificationDispatches, users } from '../db/schema';
import logger from './logger';
import { buildWhere } from './where-helpers';
import { notifyWithin, processNotificationOutbox } from '../services/messaging/notification-outbox.service';

export type AlertDispatchStatus = MonitorAlertNotifyStatus;

export interface AlertDispatchTarget {
  /** 已配置的通知渠道：email / webhook / inapp */
  channels: readonly string[];
  webhookUrl: string | null;
  /** 旧式混合标识，仅供尚未迁移的告警域使用 */
  recipients?: readonly string[];
  /** 系统用户：站内信直接投递；邮件渠道实时读取账户当前邮箱 */
  recipientUserIds?: readonly number[];
  /** 不绑定系统用户的额外邮箱 */
  recipientEmails?: readonly string[];
  /** 规则所属租户；为空表示平台级规则 */
  tenantId: number | null;
}

export interface AlertDispatchPayload<K extends NotificationEventKey = NotificationEventKey> {
  /** 事件目录中的告警事件 key */
  eventKey: K;
  /** 事件变量，用于渲染标题与正文 */
  vars: NotificationEventVars<K>;
  /** 邮件正文（HTML），覆盖默认渲染 */
  html: string;
  inAppType?: InAppMessageType;
  /** 幂等键：同一次触发重复派发时不会产生重复消息 */
  dedupeKey?: string;
  /** Webhook 请求体 */
  webhookBody: Record<string, unknown>;
  /** 日志前缀，如 `MonitorAlert` */
  logTag: string;
}

/**
 * 派发结果。调用方据此把「到底通知到人了没有」落库，
 * 否则用户配置正确却收不到通知时，界面上看不出任何异常。
 */
export interface AlertDispatchResult {
  /** `skipped` 表示没有可派发的渠道，与「派发失败」是两回事 */
  status: AlertDispatchStatus;
  /** 本次实际尝试的渠道 */
  channels: string[];
  /** 失败渠道的原因摘要，全部成功时为 null */
  error: string | null;
}

const SUPPORTED_CHANNELS: readonly string[] = ['inapp', 'email', 'webhook', 'chat'];

function isSupportedChannel(value: string): value is NotificationChannel {
  return SUPPORTED_CHANNELS.includes(value);
}

/**
 * 解析本次派发涉及的系统用户。
 *
 * 新模型直接使用稳定用户 ID；尚未迁移的告警域仍可传邮箱 / 用户名标识。
 * 停用账号不再接收告警。租户为空的平台级规则不限制租户范围。
 */
async function resolveRecipientUserIds(target: AlertDispatchTarget): Promise<number[]> {
  const userIds = uniquePositiveInts(target.recipientUserIds);
  const identifiers = [...new Set((target.recipients ?? []).map((recipient) => recipient.trim()).filter(Boolean))];
  const recipientConditions: SQL[] = [];
  if (userIds.length > 0) recipientConditions.push(inArray(users.id, userIds));
  if (identifiers.length > 0) {
    recipientConditions.push(inArray(users.email, identifiers), inArray(users.username, identifiers));
  }
  if (recipientConditions.length === 0) return [];

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(buildWhere(
      or(...recipientConditions),
      eq(users.status, 'enabled'),
      target.tenantId == null ? undefined : eq(users.tenantId, target.tenantId),
    ));
  return [...new Set(rows.map((row) => row.id))];
}

/** 规则上的额外邮箱：没有账号，按 external 收件人直投。 */
function externalEmails(target: AlertDispatchTarget): string[] {
  return [...new Set(
    [
      ...(target.recipientEmails ?? []),
      ...(target.recipients ?? []).filter((recipient) => recipient.includes('@')),
    ]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
}

/** 汇总派发留痕，还原出「每个渠道到底通没通」。 */
async function summarizeDispatch(
  outboxId: number,
  channels: NotificationChannel[],
  logTag: string,
): Promise<AlertDispatchResult> {
  const rows = await db.select({
    channel: notificationDispatches.channel,
    decision: notificationDispatches.decision,
    reasonCode: notificationDispatches.reasonCode,
    reasonDetail: notificationDispatches.reasonDetail,
  }).from(notificationDispatches).where(eq(notificationDispatches.outboxId, outboxId));

  const failures: string[] = [];
  let succeeded = 0;
  for (const channel of channels) {
    const channelRows = rows.filter((row) => row.channel === channel);
    if (channelRows.some((row) => row.decision === 'sent' || row.decision === 'deduped')) {
      succeeded += 1;
      continue;
    }
    const reason = channelRows.find((row) => row.reasonDetail)?.reasonDetail
      ?? channelRows.find((row) => row.reasonCode)
      ?? '没有匹配到可投递的接收人';
    failures.push(`${channel}: ${typeof reason === 'string' ? reason : reason.reasonCode}`);
  }

  if (failures.length > 0) {
    logger.error(`[${logTag}] 告警通知派发失败`, { outboxId, failures });
  }
  return {
    status: failures.length === 0 ? 'success' : succeeded === 0 ? 'failed' : 'partial',
    channels,
    error: failures.length > 0 ? failures.join('；') : null,
  };
}

/**
 * 按配置的渠道派发一条告警通知。
 *
 * 单个渠道失败不影响其他渠道；失败会记日志并反映在返回值里，但不抛出——
 * 告警评估器的状态机推进不应该因为下游通知不可用而中断。
 */
export async function dispatchAlertChannels<K extends NotificationEventKey>(
  target: AlertDispatchTarget,
  payload: AlertDispatchPayload<K>,
): Promise<AlertDispatchResult> {
  const channels = [...new Set((target.channels ?? []).filter(isSupportedChannel))];
  if (channels.length === 0) {
    return { status: 'skipped', channels: [], error: null };
  }

  const recipients: NotificationRecipient[] = [];
  if (channels.includes('inapp') || channels.includes('email') || channels.includes('chat')) {
    const userIds = await resolveRecipientUserIds(target);
    recipients.push(...userIds.map((id) => ({ type: 'user' as const, id })));
  }
  if (channels.includes('email')) {
    recipients.push(...externalEmails(target).map((address) => ({
      type: 'external' as const,
      channel: 'email' as const,
      address,
    })));
  }
  // Webhook 是地址而不是人：作为 external 收件人只投一次，
  // 否则规则配了 5 个接收人就会把同一个 Webhook 打 5 次
  if (channels.includes('webhook') && target.webhookUrl) {
    recipients.push({ type: 'external', channel: 'webhook', address: target.webhookUrl });
  }

  if (recipients.length === 0) {
    return { status: 'failed', channels, error: '没有匹配到任何可投递的接收人' };
  }

  const outboxId = await notifyWithin(db, payload.eventKey, {
    recipients,
    vars: payload.vars,
    tenantId: target.tenantId,
    dedupeKey: payload.dedupeKey ?? null,
    channelPolicy: { only: channels },
    channelOptions: {
      email: { html: payload.html },
      webhook: { url: target.webhookUrl ?? '', body: payload.webhookBody },
      inapp: { type: payload.inAppType },
    },
  });
  // 幂等键命中：同一次触发已经派发过，重复调用不应该被记成失败
  if (outboxId === null) {
    return { status: 'success', channels, error: null };
  }

  await processNotificationOutbox(outboxId);
  return summarizeDispatch(outboxId, channels, payload.logTag);
}
