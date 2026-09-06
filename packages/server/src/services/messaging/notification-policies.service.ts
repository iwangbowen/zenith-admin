/**
 * 通知策略服务（管理员侧）：事件目录 + 作用域覆盖 + 派发日志。
 *
 * 作用域规则：平台管理员（无租户）编辑平台级覆盖（tenantId = null），
 * 租户管理员编辑本租户覆盖；租户视图里的「默认值」已含平台覆盖，
 * 与派发时 resolver 的求值顺序一致。
 */
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  NOTIFICATION_EVENT_GROUP_LABELS,
  NOTIFICATION_EVENT_KEYS,
  eventAvailableChannels,
  getNotificationEvent,
  isNotificationEventKey,
  type NotificationChannel,
  type NotificationDecision,
  type NotificationPolicyEvent,
  type NotificationRecipientType,
  type ResetNotificationOverrideInput,
  type SaveNotificationOverrideInput,
} from '@zenith/shared/messaging';
import { db } from '../../db';
import {
  notificationDispatches,
  notificationEventOverrides,
  users,
  type NotificationEventOverrideRow,
} from '../../db/schema';
import { effectiveTenantId } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { exactTenantCondition, inheritedTenantCondition, tenantScope } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, withPagination } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { notify } from './notification-outbox.service';

/** 当前管理作用域：平台管理员为 null，租户管理员为其租户 ID。 */
function policyScopeTenantId(): number | null {
  return effectiveTenantId();
}

async function loadScopeOverrides(tenantId: number | null): Promise<NotificationEventOverrideRow[]> {
  return db.select().from(notificationEventOverrides).where(
    inheritedTenantCondition(notificationEventOverrides.tenantId, tenantId),
  );
}

// ─── 事件目录与覆盖 ───────────────────────────────────────────────────────────

export async function listNotificationPolicyEvents(): Promise<NotificationPolicyEvent[]> {
  const tenantId = policyScopeTenantId();
  const overrides = await loadScopeOverrides(tenantId);

  return NOTIFICATION_EVENT_KEYS
    .filter((key) => !getNotificationEvent(key).hidden)
    .map((key) => {
      const def = getNotificationEvent(key);
      return {
        key,
        group: def.group,
        groupLabel: NOTIFICATION_EVENT_GROUP_LABELS[def.group],
        label: def.label,
        description: def.description,
        severity: def.severity,
        mandatory: def.mandatory === true,
        bypassQuietHours: def.bypassQuietHours === true || def.severity === 'critical',
        channels: eventAvailableChannels(def).map((channel) => {
          const matched = overrides.filter((row) => row.eventKey === key && row.channel === channel);
          const platformRow = matched.find((row) => row.tenantId === null);
          const scopeRow = tenantId === null ? platformRow : matched.find((row) => row.tenantId === tenantId);
          // 租户视图的「默认」= 平台覆盖 ?? 事件默认；平台视图的「默认」= 事件默认
          const upstreamDefault = tenantId !== null && platformRow
            ? platformRow.enabled
            : def.defaultChannels.includes(channel);
          return {
            channel,
            available: true,
            defaultEnabled: upstreamDefault,
            override: scopeRow ? { enabled: scopeRow.enabled, locked: scopeRow.locked } : null,
          };
        }),
      };
    });
}

function ensureManagedEventChannel(eventKey: string, channel: NotificationChannel) {
  if (!isNotificationEventKey(eventKey)) {
    throw new HTTPException(400, { message: `未知的通知事件：${eventKey}` });
  }
  const def = getNotificationEvent(eventKey);
  if (def.hidden) throw new HTTPException(400, { message: '该事件不支持策略配置' });
  if (!eventAvailableChannels(def).includes(channel)) {
    throw new HTTPException(400, { message: `事件「${def.label}」不支持渠道 ${channel}` });
  }
  return def;
}

export async function saveNotificationOverride(input: SaveNotificationOverrideInput): Promise<void> {
  ensureManagedEventChannel(input.eventKey, input.channel);
  const tenantId = policyScopeTenantId();
  // 部分唯一索引区分平台/租户两个命名空间，onConflict 无法同时命中，
  // 用「先删后插」的事务等价实现 upsert
  await db.transaction(async (tx) => {
    await tx.delete(notificationEventOverrides).where(buildWhere(
      eq(notificationEventOverrides.eventKey, input.eventKey),
      eq(notificationEventOverrides.channel, input.channel),
      exactTenantCondition(notificationEventOverrides.tenantId, tenantId),
    ));
    await tx.insert(notificationEventOverrides).values({
      tenantId,
      eventKey: input.eventKey,
      channel: input.channel,
      enabled: input.enabled,
      locked: input.locked,
    });
  });
}

export async function resetNotificationOverride(input: ResetNotificationOverrideInput): Promise<void> {
  ensureManagedEventChannel(input.eventKey, input.channel);
  const tenantId = policyScopeTenantId();
  await db.delete(notificationEventOverrides).where(buildWhere(
    eq(notificationEventOverrides.eventKey, input.eventKey),
    eq(notificationEventOverrides.channel, input.channel),
    exactTenantCondition(notificationEventOverrides.tenantId, tenantId),
  ));
}

// ─── 测试触发 ─────────────────────────────────────────────────────────────────

/**
 * 以当前管理员为收件人真实触发一次事件:模板 {{var}} 提取变量填示例值,
 * 走完整 notify() 链路（策略/偏好/渠道适配器全部生效）,结果在「投递日志」可见。
 */
export async function testFireNotificationEvent(eventKey: string, userId: number): Promise<number | null> {
  if (!isNotificationEventKey(eventKey)) {
    throw new HTTPException(400, { message: `未知的通知事件：${eventKey}` });
  }
  const def = getNotificationEvent(eventKey);
  if (def.hidden) throw new HTTPException(400, { message: '该事件不支持测试触发' });

  const varNames = [...new Set(
    [...`${def.title}\n${def.content}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]),
  )];
  const vars = Object.fromEntries(varNames.map((name) => [name, `示例${name}`]));

  return notify(eventKey, {
    recipients: [{ type: 'user', id: userId }],
    vars: vars as never,
    tenantId: policyScopeTenantId(),
  });
}

// ─── 派发日志 ─────────────────────────────────────────────────────────────────

export interface ListNotificationDispatchesQuery {
  page: number;
  pageSize: number;
  eventKey?: string;
  channel?: NotificationChannel;
  decision?: NotificationDecision;
  recipientType?: NotificationRecipientType;
  recipientId?: number;
  startTime?: string;
  endTime?: string;
}

export async function listNotificationDispatches(q: ListNotificationDispatchesQuery) {
  const conditions: (SQL | undefined)[] = [
    tenantScope(notificationDispatches),
    q.eventKey ? eq(notificationDispatches.eventKey, q.eventKey) : undefined,
    q.channel ? eq(notificationDispatches.channel, q.channel) : undefined,
    q.decision ? eq(notificationDispatches.decision, q.decision) : undefined,
    q.recipientType ? eq(notificationDispatches.recipientType, q.recipientType) : undefined,
    q.recipientId !== undefined ? eq(notificationDispatches.recipientId, q.recipientId) : undefined,
    ...dateRangeConditions(notificationDispatches.createdAt, q.startTime, q.endTime),
  ];
  const where = buildWhere(...conditions);

  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(notificationDispatches, where),
    rows: () => withPagination(
      db.select({
        dispatch: notificationDispatches,
        username: users.username,
        nickname: users.nickname,
      })
        .from(notificationDispatches)
        .leftJoin(users, and(
          eq(notificationDispatches.recipientType, 'user'),
          eq(notificationDispatches.recipientId, users.id),
        ))
        .where(where)
        .orderBy(desc(notificationDispatches.id))
        .$dynamic(),
      q.page,
      q.pageSize,
    ),
    map: ({ dispatch, username, nickname }) => ({
      id: dispatch.id,
      outboxId: dispatch.outboxId,
      eventKey: dispatch.eventKey,
      eventLabel: isNotificationEventKey(dispatch.eventKey)
        ? getNotificationEvent(dispatch.eventKey).label
        : dispatch.eventKey,
      recipientType: dispatch.recipientType,
      recipientId: dispatch.recipientId,
      recipientName: nickname || username || null,
      recipientAddress: dispatch.recipientAddress,
      channel: dispatch.channel,
      decision: dispatch.decision,
      reasonCode: dispatch.reasonCode,
      reasonDetail: dispatch.reasonDetail,
      providerMsgId: dispatch.providerMsgId,
      tenantId: dispatch.tenantId,
      createdAt: formatDateTime(dispatch.createdAt),
    }),
  });
}
