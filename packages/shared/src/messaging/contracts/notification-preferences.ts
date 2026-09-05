import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DIGEST_MODES,
  NOTIFICATION_EVENT_GROUPS,
  NOTIFICATION_RECIPIENT_TYPES,
  NOTIFICATION_SEVERITIES,
} from '../constants';
import { saveNotificationPreferencesSchema, saveNotificationSettingsSchema } from '../validation';

// ─── 实体：偏好矩阵 ──────────────────────────────────────────────────────────

/** 偏好矩阵中一个「事件 × 渠道」格子的可视状态 */
export const notificationMatrixChannelSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  available: z.boolean().meta({ description: '该事件是否开放此渠道（不开放的渠道不渲染开关）' }),
  enabled: z.boolean().meta({ description: '当前生效值（偏好 → 租户/平台覆盖 → 事件默认 逐层求值）' }),
  locked: z.boolean().meta({ description: '管理员已锁定，用户不可修改' }),
  defaultEnabled: z.boolean().meta({ description: '无任何覆盖时的默认值，用于「恢复默认」与稀疏存储判断' }),
}).meta({ id: 'NotificationMatrixChannel' });

export type NotificationMatrixChannel = z.infer<typeof notificationMatrixChannelSchema>;

export const notificationMatrixEventSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  severity: z.enum(NOTIFICATION_SEVERITIES),
  mandatory: z.boolean().meta({ description: '强制事件：整行锁定' }),
  channels: z.array(notificationMatrixChannelSchema),
}).meta({ id: 'NotificationMatrixEvent' });

export type NotificationMatrixEvent = z.infer<typeof notificationMatrixEventSchema>;

export const notificationMatrixGroupSchema = z.object({
  group: z.enum(NOTIFICATION_EVENT_GROUPS),
  label: z.string(),
  events: z.array(notificationMatrixEventSchema),
}).meta({ id: 'NotificationMatrixGroup' });

export type NotificationMatrixGroup = z.infer<typeof notificationMatrixGroupSchema>;

// ─── 实体：收件人的全局通知设置 ──────────────────────────────────────────────

export const notificationRecipientSettingsSchema = z.object({
  recipientType: z.enum(NOTIFICATION_RECIPIENT_TYPES),
  recipientId: z.int(),
  globalMuted: z.boolean(),
  timezone: z.string(),
  quietStart: z.string().nullable().meta({ description: '免打扰起始 HH:mm；与 quietEnd 同时为空表示未启用' }),
  quietEnd: z.string().nullable(),
  digestMode: z.enum(NOTIFICATION_DIGEST_MODES),
  digestHour: z.int().meta({ description: 'daily 摘要的发送小时（0-23）' }),
  updatedAt: z.string(),
}).meta({ id: 'NotificationSettings' });

export type NotificationRecipientSettings = z.infer<typeof notificationRecipientSettingsSchema>;

// ─── 契约（登录用户自助，不挂权限码） ─────────────────────────────────────────

export const notificationPreferenceContract = defineContract('/api/notification-preferences', {
  matrix: op.get('/matrix', { response: z.array(notificationMatrixGroupSchema), summary: '我的通知偏好矩阵' }),
  saveMatrix: op.put('/matrix', { body: saveNotificationPreferencesSchema, summary: '保存我的通知偏好' }),
  settings: op.get('/settings', { response: notificationRecipientSettingsSchema, summary: '我的通知全局设置' }),
  saveSettings: op.put('/settings', { body: saveNotificationSettingsSchema, response: notificationRecipientSettingsSchema, summary: '保存我的通知全局设置' }),
}, { tags: ['NotificationPreferences'] });
