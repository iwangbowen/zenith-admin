/**
 * 偏好解析引擎：决定「这条事件，对这个收件人，在哪些渠道上真正发出去」。
 *
 * 解析与投递刻意分成两步。合成一步的话，被抑制的通知就只剩一行日志，
 * 而用户来问「为什么我没收到」时最需要的恰恰是这一步的结论与依据。
 */
import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type {
  NotificationChannel,
  NotificationChannelPolicy,
  NotificationEventDef,
  NotificationEventKey,
  NotificationReasonCode,
  NotificationRecipient,
  NotificationRecipientType,
} from '@zenith/shared/messaging';
import { eventAvailableChannels } from '@zenith/shared/messaging';
import { db } from '../../db';
import {
  notificationEventOverrides,
  notificationPreferences,
  notificationRecipientSettings,
  type NotificationEventOverrideRow,
  type NotificationRecipientSettingsRow,
} from '../../db/schema';
import { inheritedTenantCondition } from '../tenant';
import { hasNotificationAdapter } from './registry';

export interface ChannelResolution {
  channel: NotificationChannel;
  allowed: boolean;
  reasonCode: NotificationReasonCode | null;
  /** 命中免打扰 / 摘要时的重投时间；为空表示立即投递 */
  deferUntil: Date | null;
  /** 延后类型：quiet 到点逐条重投；digest 由聚合任务合并成摘要 */
  deferKind?: 'quiet' | 'digest';
  /** 该渠道对收件人不可自行关闭（必达事件或管理员锁定），适配器据此隐藏退订入口 */
  locked?: boolean;
}

export interface RecipientResolution {
  recipient: NotificationRecipient;
  channels: ChannelResolution[];
}

export interface ResolveInput {
  eventKey: NotificationEventKey;
  event: NotificationEventDef;
  recipients: readonly NotificationRecipient[];
  tenantId: number | null;
  policy: NotificationChannelPolicy | null;
  /** 判定免打扰的基准时间，测试可注入 */
  now?: Date;
}

function recipientKey(type: NotificationRecipientType, id: number): string {
  return `${type}:${id}`;
}

/**
 * 本次派发的候选渠道全集。
 *
 * 取 `availableChannels` 而非 `defaultChannels`：用户把某个非默认渠道主动打开后，
 * 它必须进入候选集才有机会被投递，否则偏好开关看着生效、实际永远不发。
 */
function candidateChannels(event: NotificationEventDef, policy: NotificationChannelPolicy | null): NotificationChannel[] {
  const base = policy?.only ?? eventAvailableChannels(event);
  const merged = new Set<NotificationChannel>([...base, ...(policy?.enable ?? [])]);
  for (const channel of policy?.disable ?? []) merged.delete(channel);
  return [...merged];
}

/** 未做任何覆盖时该渠道是否默认开启。 */
function defaultEnabled(event: NotificationEventDef, policy: NotificationChannelPolicy | null, channel: NotificationChannel): boolean {
  if (policy?.disable?.includes(channel)) return false;
  if (policy?.enable?.includes(channel)) return true;
  const base = policy?.only ?? event.defaultChannels;
  return base.includes(channel);
}

/** `HH:mm` → 当日分钟数；格式非法返回 null。 */
function parseClockMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 收件人本地时间的当日分钟数。 */
function localMinutes(at: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
    const [hour, minute] = parts.split(':').map(Number);
    return hour * 60 + minute;
  } catch {
    // 时区名非法时退回服务器本地时间，总比整条通知因为一个配置串而崩掉要好
    return at.getHours() * 60 + at.getMinutes();
  }
}

/**
 * 下一个摘要投递时刻。
 * hourly 取下一个整点；daily 取收件人本地时间的下一个 digestHour 整点。
 */
function nextDigestTime(settings: NotificationRecipientSettingsRow, now: Date): Date {
  if (settings.digestMode === 'hourly') {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }
  const nowMinutes = localMinutes(now, settings.timezone);
  let remaining = settings.digestHour * 60 - nowMinutes;
  if (remaining <= 0) remaining += 24 * 60;
  const next = new Date(now.getTime() + remaining * 60_000);
  next.setSeconds(0, 0);
  return next;
}

interface QuietWindow {
  active: boolean;
  /** 距离免打扰结束还有多少分钟 */
  minutesUntilEnd: number;
}

/**
 * 判定免打扰窗口，支持跨零点（如 22:00–08:00）。
 *
 * 结束时刻按「当前时间 + 剩余分钟数」推算，而不是构造目标时区的绝对时间：
 * 后者要处理夏令时与偏移解析，收益却只是把极端情况下的误差从一小时降到零。
 */
function evaluateQuietWindow(settings: NotificationRecipientSettingsRow, at: Date): QuietWindow {
  const start = parseClockMinutes(settings.quietStart);
  const end = parseClockMinutes(settings.quietEnd);
  if (start === null || end === null || start === end) return { active: false, minutesUntilEnd: 0 };

  const nowMinutes = localMinutes(at, settings.timezone);
  const active = start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
  if (!active) return { active: false, minutesUntilEnd: 0 };

  let remaining = end - nowMinutes;
  if (remaining <= 0) remaining += 24 * 60;
  return { active: true, minutesUntilEnd: remaining };
}

/** 租户级覆盖优先于平台级；同一渠道两者都有时取租户行。 */
function pickOverride(
  rows: NotificationEventOverrideRow[],
  channel: NotificationChannel,
  tenantId: number | null,
): NotificationEventOverrideRow | undefined {
  const matched = rows.filter((row) => row.channel === channel);
  if (tenantId !== null) {
    const tenantRow = matched.find((row) => row.tenantId === tenantId);
    if (tenantRow) return tenantRow;
  }
  return matched.find((row) => row.tenantId === null);
}

async function loadOverrides(eventKey: string, tenantId: number | null): Promise<NotificationEventOverrideRow[]> {
  return db.select().from(notificationEventOverrides).where(and(
    eq(notificationEventOverrides.eventKey, eventKey),
    inheritedTenantCondition(notificationEventOverrides.tenantId, tenantId),
  ));
}

/** 按收件人类型分组批量查询，避免 N 个收件人打 N 次库。 */
function groupedRecipientCondition(
  typeColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  byType: Map<NotificationRecipientType, number[]>,
): SQL | undefined {
  const conditions: SQL[] = [];
  for (const [type, ids] of byType) {
    if (ids.length === 0) continue;
    const condition = and(eq(typeColumn, type), inArray(idColumn, ids));
    if (condition) conditions.push(condition);
  }
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

export async function resolveDispatchPlan(input: ResolveInput): Promise<RecipientResolution[]> {
  const { event, eventKey, recipients, tenantId, policy } = input;
  const now = input.now ?? new Date();
  const channels = candidateChannels(event, policy);

  const identified = recipients.filter(
    (r): r is Extract<NotificationRecipient, { type: 'user' | 'member' }> => r.type !== 'external',
  );
  const byType = new Map<NotificationRecipientType, number[]>();
  for (const recipient of identified) {
    const list = byType.get(recipient.type) ?? [];
    list.push(recipient.id);
    byType.set(recipient.type, list);
  }

  const recipientCondition = groupedRecipientCondition(
    notificationPreferences.recipientType,
    notificationPreferences.recipientId,
    byType,
  );
  const settingsCondition = groupedRecipientCondition(
    notificationRecipientSettings.recipientType,
    notificationRecipientSettings.recipientId,
    byType,
  );

  const [overrides, preferenceRows, settingsRows] = await Promise.all([
    loadOverrides(eventKey, tenantId),
    recipientCondition
      ? db.select().from(notificationPreferences).where(and(eq(notificationPreferences.eventKey, eventKey), recipientCondition))
      : Promise.resolve([]),
    settingsCondition
      ? db.select().from(notificationRecipientSettings).where(settingsCondition)
      : Promise.resolve([]),
  ]);

  const preferenceMap = new Map<string, boolean>();
  for (const row of preferenceRows) {
    preferenceMap.set(`${recipientKey(row.recipientType, row.recipientId)}|${row.channel}`, row.enabled);
  }
  const settingsMap = new Map<string, NotificationRecipientSettingsRow>();
  for (const row of settingsRows) {
    settingsMap.set(recipientKey(row.recipientType, row.recipientId), row);
  }

  return recipients.map((recipient) => {
    // external 收件人是告警规则里手填的裸邮箱 / Webhook 地址，没有账号也就没有偏好可言，
    // 只按渠道匹配直投，否则规则配了外部接收人却永远发不出去。
    if (recipient.type === 'external') {
      return {
        recipient,
        channels: channels.map((channel) => ({
          channel,
          allowed: channel === recipient.channel && hasNotificationAdapter(channel),
          reasonCode: channel !== recipient.channel
            ? 'preference_off' as const
            : hasNotificationAdapter(channel) ? null : 'channel_unavailable' as const,
          deferUntil: null,
        })),
      };
    }

    const key = recipientKey(recipient.type, recipient.id);
    const settings = settingsMap.get(key);
    const quiet = settings ? evaluateQuietWindow(settings, now) : { active: false, minutesUntilEnd: 0 };
    const bypassQuiet = event.bypassQuietHours === true || event.severity === 'critical';

    const resolutions = channels.map<ChannelResolution>((channel) => {
      if (!hasNotificationAdapter(channel)) {
        return { channel, allowed: false, reasonCode: 'channel_unavailable', deferUntil: null };
      }

      const override = pickOverride(overrides, channel, tenantId);
      const preference = preferenceMap.get(`${key}|${channel}`);
      const fallback = defaultEnabled(event, policy, channel);
      const locked = event.mandatory === true || override?.locked === true;

      let enabled: boolean;
      if (event.mandatory) {
        // 强制事件跳过收件人偏好，但仍允许管理员通过覆盖调整投递渠道
        enabled = override ? override.enabled : fallback;
      } else if (override?.locked) {
        enabled = override.enabled;
      } else if (preference !== undefined) {
        enabled = preference;
      } else if (override) {
        enabled = override.enabled;
      } else {
        enabled = fallback;
      }

      if (!enabled) {
        return { channel, allowed: false, reasonCode: 'preference_off', deferUntil: null };
      }
      if (settings?.globalMuted && !event.mandatory) {
        return { channel, allowed: false, reasonCode: 'globally_muted', deferUntil: null };
      }
      // 摘要模式：邮件改为按窗口聚合成一封摘要（摘要邮件自身除外，否则会无限自我延后）。
      // 站内信不参与摘要——收件箱本身就是被动聚合的。
      if (
        channel === 'email'
        && settings && settings.digestMode !== 'realtime'
        && !event.mandatory && !bypassQuiet
        && input.eventKey !== 'messaging.digest'
      ) {
        return {
          channel,
          allowed: false,
          reasonCode: 'digest',
          deferUntil: nextDigestTime(settings, now),
          deferKind: 'digest',
        };
      }
      // 站内信不会主动打扰人，免打扰时段照常落库，否则用户回到系统里会看到通知凭空缺了一段
      if (quiet.active && !bypassQuiet && channel !== 'inapp') {
        return {
          channel,
          allowed: false,
          reasonCode: 'quiet_hours',
          deferUntil: new Date(now.getTime() + quiet.minutesUntilEnd * 60_000),
          deferKind: 'quiet',
        };
      }
      return { channel, allowed: true, reasonCode: null, deferUntil: null, locked };
    });

    return { recipient, channels: resolutions };
  });
}
