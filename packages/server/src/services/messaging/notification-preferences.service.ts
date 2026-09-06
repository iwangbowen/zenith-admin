/**
 * 通知偏好服务：个人偏好矩阵、全局设置与退订应用。
 *
 * 矩阵是「事件目录 × 渠道」逐层求值的结果（用户偏好 → 租户/平台覆盖 → 事件默认），
 * 求值优先级与 lib/notification/resolver.ts 保持一致——那边决定发不发，
 * 这边决定界面上开关显示成什么样，两边不一致用户会觉得开关是坏的。
 *
 * 偏好持久化保持稀疏：与「无偏好时的生效值」相同的项直接删行，
 * 这样管理员日后调整默认渠道能自动对未显式表态的用户生效。
 */
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  NOTIFICATION_EVENT_GROUP_LABELS,
  NOTIFICATION_EVENT_KEYS,
  eventAvailableChannels,
  getNotificationEvent,
  isNotificationEventKey,
  type NotificationChannel,
  type NotificationEventGroup,
  type NotificationEventKey,
  type NotificationMatrixChannel,
  type NotificationMatrixEvent,
  type NotificationMatrixGroup,
  type NotificationRecipientSettings,
  type SaveNotificationPreferencesInput,
  type SaveNotificationSettingsInput,
} from '@zenith/shared/messaging';
import { db } from '../../db';
import {
  members,
  notificationEventOverrides,
  notificationPreferences,
  notificationRecipientSettings,
  users,
  type NotificationEventOverrideRow,
} from '../../db/schema';
import { currentTenantId, currentUserId } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { inheritedTenantCondition } from '../../lib/tenant';
import type { UnsubscribePayload } from '../../lib/notification/unsubscribe';

interface RecipientRef {
  type: 'user' | 'member';
  id: number;
}

function currentRecipient(): RecipientRef {
  return { type: 'user', id: currentUserId() };
}

/** 当前作用域可见的覆盖行：平台行 + 本租户行（租户行优先）。 */
async function loadEffectiveOverrides(tenantId: number | null): Promise<NotificationEventOverrideRow[]> {
  return db.select().from(notificationEventOverrides).where(
    inheritedTenantCondition(notificationEventOverrides.tenantId, tenantId),
  );
}

function pickOverride(
  rows: NotificationEventOverrideRow[],
  eventKey: string,
  channel: NotificationChannel,
  tenantId: number | null,
): NotificationEventOverrideRow | undefined {
  const matched = rows.filter((row) => row.eventKey === eventKey && row.channel === channel);
  if (tenantId !== null) {
    const tenantRow = matched.find((row) => row.tenantId === tenantId);
    if (tenantRow) return tenantRow;
  }
  return matched.find((row) => row.tenantId === null);
}

/** 无用户偏好时该渠道的生效值（覆盖 → 事件默认）。 */
function baselineEnabled(
  overrides: NotificationEventOverrideRow[],
  eventKey: string,
  channel: NotificationChannel,
  tenantId: number | null,
): { enabled: boolean; locked: boolean } {
  const def = getNotificationEvent(eventKey as NotificationEventKey);
  const override = pickOverride(overrides, eventKey, channel, tenantId);
  return {
    enabled: override ? override.enabled : def.defaultChannels.includes(channel),
    locked: override?.locked ?? false,
  };
}

// ─── 偏好矩阵 ─────────────────────────────────────────────────────────────────

export async function getMyNotificationMatrix(): Promise<NotificationMatrixGroup[]> {
  const recipient = currentRecipient();
  const tenantId = currentTenantId();

  const [overrides, prefRows] = await Promise.all([
    loadEffectiveOverrides(tenantId),
    db.select().from(notificationPreferences).where(and(
      eq(notificationPreferences.recipientType, recipient.type),
      eq(notificationPreferences.recipientId, recipient.id),
    )),
  ]);
  const prefMap = new Map(prefRows.map((row) => [`${row.eventKey}|${row.channel}`, row.enabled]));

  const groups = new Map<NotificationEventGroup, NotificationMatrixEvent[]>();
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const def = getNotificationEvent(key);
    if (def.hidden) continue;
    const channels: NotificationMatrixChannel[] = eventAvailableChannels(def).map((channel) => {
      const baseline = baselineEnabled(overrides, key, channel, tenantId);
      const pref = prefMap.get(`${key}|${channel}`);
      const locked = def.mandatory === true || baseline.locked;
      return {
        channel,
        available: true,
        enabled: locked ? baseline.enabled : (pref ?? baseline.enabled),
        locked,
        defaultEnabled: baseline.enabled,
      };
    });
    const events = groups.get(def.group) ?? [];
    events.push({
      key,
      label: def.label,
      description: def.description,
      severity: def.severity,
      mandatory: def.mandatory === true,
      channels,
    });
    groups.set(def.group, events);
  }

  return [...groups.entries()].map(([group, events]) => ({
    group,
    label: NOTIFICATION_EVENT_GROUP_LABELS[group],
    events,
  }));
}

export async function saveMyNotificationPreferences(input: SaveNotificationPreferencesInput): Promise<void> {
  const recipient = currentRecipient();
  const tenantId = currentTenantId();
  const overrides = await loadEffectiveOverrides(tenantId);

  await db.transaction(async (tx) => {
    for (const item of input.items) {
      if (!isNotificationEventKey(item.eventKey)) {
        throw new HTTPException(400, { message: `未知的通知事件：${item.eventKey}` });
      }
      const def = getNotificationEvent(item.eventKey);
      if (def.hidden || !eventAvailableChannels(def).includes(item.channel)) {
        throw new HTTPException(400, { message: `事件「${def.label}」不支持渠道 ${item.channel}` });
      }
      if (def.mandatory) {
        throw new HTTPException(400, { message: `「${def.label}」为必达通知，不可关闭` });
      }
      const baseline = baselineEnabled(overrides, item.eventKey, item.channel, tenantId);
      if (baseline.locked) {
        throw new HTTPException(400, { message: `「${def.label}」的 ${item.channel} 渠道已由管理员统一管理` });
      }

      const rowKey = and(
        eq(notificationPreferences.recipientType, recipient.type),
        eq(notificationPreferences.recipientId, recipient.id),
        eq(notificationPreferences.eventKey, item.eventKey),
        eq(notificationPreferences.channel, item.channel),
      );
      if (item.enabled === baseline.enabled) {
        // 与生效默认一致 → 删行保持稀疏，让默认值的后续调整能继续作用于该用户
        await tx.delete(notificationPreferences).where(rowKey);
      } else {
        await tx.insert(notificationPreferences).values({
          recipientType: recipient.type,
          recipientId: recipient.id,
          eventKey: item.eventKey,
          channel: item.channel,
          enabled: item.enabled,
        }).onConflictDoUpdate({
          target: [
            notificationPreferences.recipientType,
            notificationPreferences.recipientId,
            notificationPreferences.eventKey,
            notificationPreferences.channel,
          ],
          set: { enabled: item.enabled },
        });
      }
    }
  });
}

// ─── 全局设置 ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  globalMuted: false,
  timezone: 'Asia/Shanghai',
  quietStart: null as string | null,
  quietEnd: null as string | null,
  digestMode: 'realtime' as const,
  digestHour: 9,
};

export async function getMyNotificationSettings(): Promise<NotificationRecipientSettings> {
  const recipient = currentRecipient();
  const [row] = await db.select().from(notificationRecipientSettings).where(and(
    eq(notificationRecipientSettings.recipientType, recipient.type),
    eq(notificationRecipientSettings.recipientId, recipient.id),
  )).limit(1);
  return {
    recipientType: recipient.type,
    recipientId: recipient.id,
    globalMuted: row?.globalMuted ?? DEFAULT_SETTINGS.globalMuted,
    timezone: row?.timezone ?? DEFAULT_SETTINGS.timezone,
    quietStart: row?.quietStart ?? DEFAULT_SETTINGS.quietStart,
    quietEnd: row?.quietEnd ?? DEFAULT_SETTINGS.quietEnd,
    digestMode: row?.digestMode ?? DEFAULT_SETTINGS.digestMode,
    digestHour: row?.digestHour ?? DEFAULT_SETTINGS.digestHour,
    updatedAt: formatDateTime(row?.updatedAt ?? new Date()),
  };
}

export async function saveMyNotificationSettings(input: SaveNotificationSettingsInput): Promise<NotificationRecipientSettings> {
  const recipient = currentRecipient();
  await db.insert(notificationRecipientSettings).values({
    recipientType: recipient.type,
    recipientId: recipient.id,
    ...input,
  }).onConflictDoUpdate({
    target: [notificationRecipientSettings.recipientType, notificationRecipientSettings.recipientId],
    set: { ...input },
  });
  return getMyNotificationSettings();
}

// ─── 退订应用 ─────────────────────────────────────────────────────────────────

export interface ApplyUnsubscribeResult {
  /** 实际退订成功的事件名 */
  eventLabels: string[];
  /** 被管理员锁定、无法退订的事件名（写偏好行也不会生效，必须如实告知） */
  lockedLabels: string[];
}

/** 收件人归属租户：锁定判定需要与派发时相同的覆盖作用域。 */
async function lookupRecipientTenantId(payload: UnsubscribePayload): Promise<number | null> {
  if (payload.recipientType === 'user') {
    const [row] = await db.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.id, payload.recipientId)).limit(1);
    return row?.tenantId ?? null;
  }
  const [row] = await db.select({ tenantId: members.tenantId }).from(members)
    .where(eq(members.id, payload.recipientId)).limit(1);
  return row?.tenantId ?? null;
}

/** 应用退订令牌：把邮件渠道偏好显式置为关闭。幂等，可重复调用。 */
export async function applyUnsubscribe(payload: UnsubscribePayload): Promise<ApplyUnsubscribeResult> {
  const targets: string[] = payload.scope === 'event'
    ? [payload.eventKey!]
    : NOTIFICATION_EVENT_KEYS.filter((key) => {
      const def = getNotificationEvent(key);
      return !def.hidden && !def.mandatory && eventAvailableChannels(def).includes('email');
    });

  const tenantId = await lookupRecipientTenantId(payload);
  const overrides = await loadEffectiveOverrides(tenantId);

  const labels: string[] = [];
  const lockedLabels: string[] = [];
  await db.transaction(async (tx) => {
    for (const eventKey of targets) {
      if (!isNotificationEventKey(eventKey)) continue;
      const def = getNotificationEvent(eventKey);
      // hidden：摘要等元事件不在偏好矩阵，写入的退订行用户永远看不见也改不回；
      // mandatory / locked：派发时偏好被跳过，写了也不生效——「退订成功却继续收到」是合规事故
      if (def.hidden || def.mandatory) continue;
      if (baselineEnabled(overrides, eventKey, 'email', tenantId).locked) {
        lockedLabels.push(def.label);
        continue;
      }
      labels.push(def.label);
      await tx.insert(notificationPreferences).values({
        recipientType: payload.recipientType,
        recipientId: payload.recipientId,
        eventKey,
        channel: 'email',
        enabled: false,
      }).onConflictDoUpdate({
        target: [
          notificationPreferences.recipientType,
          notificationPreferences.recipientId,
          notificationPreferences.eventKey,
          notificationPreferences.channel,
        ],
        set: { enabled: false },
      });
    }
  });
  return { eventLabels: labels, lockedLabels };
}
