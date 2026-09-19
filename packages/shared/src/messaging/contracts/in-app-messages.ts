import * as z from 'zod';
import { batchIdsBody, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IN_APP_MESSAGE_TYPES, SEND_SOURCES } from '../constants';
import { sendInAppSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const inAppMessageSchema = z.object({
  id: z.int(),
  templateId: z.int().nullable(),
  templateName: z.string().nullable(),
  userId: z.int().meta({ description: '收件人用户 ID' }),
  username: z.string().nullable().meta({ description: '收件人展示名（昵称优先），仅管理员列表返回' }),
  title: z.string(),
  content: z.string(),
  type: z.enum(IN_APP_MESSAGE_TYPES),
  isRead: z.boolean(),
  readAt: z.string().nullable(),
  source: z.enum(SEND_SOURCES),
  senderId: z.int().nullable(),
  senderName: z.string().nullable(),
  link: z.string().nullable().meta({ description: '深链地址（站内路由，点击消息跳转）' }),
  createdAt: z.string(),
}).meta({ id: 'InAppMessage' });

export type InAppMessage = z.infer<typeof inAppMessageSchema>;

export const inAppSendResultSchema = z.object({
  sentCount: z.int(),
}).meta({ id: 'InAppSendResult' });

export type InAppSendResult = z.infer<typeof inAppSendResultSchema>;

export const inAppUnreadCountSchema = z.object({
  count: z.int(),
}).meta({ id: 'UnreadCount' });

export type InAppUnreadCount = z.infer<typeof inAppUnreadCountSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────


export const inAppMessageListQuery = paginationQuery.extend({
  keyword: keywordQuery('标题'),
  type: queryEnum(IN_APP_MESSAGE_TYPES),
  isRead: queryBool(),
});

export const inAppMessageAdminListQuery = inAppMessageListQuery.extend({
  recipientId: idQuery(),
  senderId: idQuery(),
  source: queryEnum(SEND_SOURCES),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const inAppMessageContract = defineContract('/api/in-app-messages', {
  list: op.get('/', { access: 'authenticated', query: inAppMessageListQuery, response: paginated(inAppMessageSchema), summary: '我的站内信列表' }),
  adminList: op.get('/admin', { access: { permission: 'system:in-app-message:list' }, query: inAppMessageAdminListQuery, response: paginated(inAppMessageSchema), summary: '管理员视角：全部站内信' }),
  adminMarkAllRead: op.post('/admin/read-all', { access: { permission: 'system:in-app-message:read' }, audit: '管理员全部标记站内信已读', summary: '管理员：全部标记为已读' }),
  adminMarkRead: op.post('/admin/{id}/read', { access: { permission: 'system:in-app-message:read' }, audit: '管理员标记站内信已读', params: idParam, summary: '管理员：标记任意站内信为已读' }),
  adminRemove: op.delete('/admin/{id}', { access: { permission: 'system:in-app-message:delete' }, audit: '管理员删除站内信', params: idParam, summary: '管理员：删除任意站内信' }),
  unreadCount: op.get('/unread-count', { access: 'authenticated', response: inAppUnreadCountSchema, summary: '未读消息数' }),
  send: op.post('/send', { access: { permission: 'system:in-app-template:list' }, audit: '发送站内信', body: sendInAppSchema, response: inAppSendResultSchema, summary: '发送站内信' }),
  markAllRead: op.post('/read-all', { access: { permission: 'system:in-app-message:read' }, summary: '全部标记为已读' }),
  markReadBatch: op.post('/batch-read', { access: { permission: 'system:in-app-message:read' }, body: batchIdsBody, summary: '批量标记为已读' }),
  removeBatch: op.delete('/batch', { access: { permission: 'system:in-app-message:delete' }, body: batchIdsBody, summary: '批量删除站内信' }),
  detail: op.get('/{id}', { access: 'authenticated', params: idParam, response: inAppMessageSchema, summary: '我的站内信详情' }),
  markRead: op.post('/{id}/read', { access: { permission: 'system:in-app-message:read' }, params: idParam, summary: '标记为已读' }),
  remove: op.delete('/{id}', { access: { permission: 'system:in-app-message:delete' }, params: idParam, summary: '删除站内信' }),
}, { auditModule: '收件记录', tags: ['InAppMessages'] });
