import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DECISIONS,
  NOTIFICATION_EVENT_GROUPS,
  NOTIFICATION_RECIPIENT_TYPES,
  NOTIFICATION_SEVERITIES,
} from '../constants';
import { resetNotificationOverrideSchema, saveNotificationOverrideSchema, testFireNotificationSchema } from '../validation';

// ─── 实体：策略中心的事件行（目录信息 + 当前作用域的覆盖） ─────────────────────

export const notificationPolicyChannelSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  available: z.boolean(),
  defaultEnabled: z.boolean().meta({ description: '租户视图 = 平台覆盖 ?? 事件默认；平台视图 = 事件默认' }),
  override: z.object({ enabled: z.boolean(), locked: z.boolean() }).nullable().meta({ description: '当前作用域的覆盖；null = 未覆盖' }),
}).meta({ id: 'NotificationPolicyChannel' });

export type NotificationPolicyChannel = z.infer<typeof notificationPolicyChannelSchema>;

export const notificationPolicyEventSchema = z.object({
  key: z.string(),
  group: z.enum(NOTIFICATION_EVENT_GROUPS),
  groupLabel: z.string(),
  label: z.string(),
  description: z.string().optional(),
  severity: z.enum(NOTIFICATION_SEVERITIES),
  mandatory: z.boolean(),
  bypassQuietHours: z.boolean(),
  channels: z.array(notificationPolicyChannelSchema),
}).meta({ id: 'NotificationPolicyEvent' });

export type NotificationPolicyEvent = z.infer<typeof notificationPolicyEventSchema>;

/** 派发日志（含抑制归因） */
export const notificationDispatchSchema = z.object({
  id: z.int(),
  outboxId: z.int().nullable(),
  eventKey: z.string(),
  eventLabel: z.string().meta({ description: '事件名；事件已下线时回落为 eventKey' }),
  recipientType: z.enum(NOTIFICATION_RECIPIENT_TYPES),
  recipientId: z.int().nullable(),
  recipientName: z.string().nullable().meta({ description: 'user 主体的昵称 / 用户名' }),
  recipientAddress: z.string().nullable(),
  channel: z.enum(NOTIFICATION_CHANNELS),
  decision: z.enum(NOTIFICATION_DECISIONS),
  reasonCode: z.string().nullable(),
  reasonDetail: z.string().nullable(),
  providerMsgId: z.string().nullable(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
}).meta({ id: 'NotificationDispatch' });

export type NotificationDispatch = z.infer<typeof notificationDispatchSchema>;

export const notificationTestFireResultSchema = z.object({
  outboxId: z.int().nullable().meta({ description: '写入的 outbox 记录 ID；事件被整体抑制时为 null' }),
}).meta({ id: 'NotificationTestFireResult' });

export type NotificationTestFireResult = z.infer<typeof notificationTestFireResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const notificationDispatchListQuery = paginationQuery.extend({
  eventKey: z.string().optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  decision: z.enum(NOTIFICATION_DECISIONS).optional(),
  recipientType: z.enum(NOTIFICATION_RECIPIENT_TYPES).optional(),
  recipientId: z.coerce.number().int().positive().optional(),
  startTime: dateRangeBound('派发时间起'),
  endTime: dateRangeBound('派发时间止'),
});

export const notificationPolicyContract = defineContract('/api/notification-policies', {
  events: op.get('/events', { response: z.array(notificationPolicyEventSchema), summary: '通知事件目录与当前作用域覆盖' }),
  saveOverride: op.put('/overrides', { body: saveNotificationOverrideSchema, summary: '保存事件渠道覆盖' }),
  resetOverride: op.post('/overrides/reset', { body: resetNotificationOverrideSchema, summary: '重置事件渠道覆盖（恢复默认）' }),
  testFire: op.post('/test-fire', { body: testFireNotificationSchema, response: notificationTestFireResultSchema, summary: '测试触发事件（真实派发给当前管理员）' }),
  dispatches: op.get('/dispatches', { query: notificationDispatchListQuery, response: paginated(notificationDispatchSchema), summary: '通知派发日志（含抑制归因）' }),
}, { tags: ['NotificationPolicies'] });
