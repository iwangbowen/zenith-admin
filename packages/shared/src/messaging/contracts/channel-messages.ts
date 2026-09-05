import * as z from 'zod';
import { chatMessageExtraSchema } from '../../chat/contracts/chat-messages';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { audienceEstimateSchema, publishChannelSchema } from '../../mp/validation';
import { CHANNEL_MESSAGE_STATUSES, CHANNEL_MESSAGE_TYPES } from '../constants';
import { createChannelTemplateSchema, updateChannelTemplateSchema } from '../validation';
import { channelMessageSchema } from './channels';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 群发消息模板 */
export const channelMessageTemplateSchema = z.object({
  id: z.int(),
  name: z.string(),
  type: z.enum(CHANNEL_MESSAGE_TYPES),
  title: z.string().nullable(),
  content: z.string(),
  extra: chatMessageExtraSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ChannelMessageTemplate' });

export type ChannelMessageTemplate = z.infer<typeof channelMessageTemplateSchema>;

export const channelAudienceEstimateSchema = z.object({
  count: z.int().meta({ description: '预估受众人数' }),
}).meta({ id: 'ChannelAudienceEstimate' });

export type ChannelAudienceEstimate = z.infer<typeof channelAudienceEstimateSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const channelAdminMessageListQuery = paginationQuery.extend({
  status: z.enum(CHANNEL_MESSAGE_STATUSES).optional(),
});

// ─── 契约：群发 / 消息记录管理 / 群发模板 ─────────────────────────────────────

export const channelMessageContract = defineContract('/api/channels', {
  publish: op.post('/{id}/publish', { params: idParam, body: publishChannelSchema, response: channelMessageSchema, summary: '向频道群发消息' }),
  testSend: op.post('/{id}/test-send', { params: idParam, body: publishChannelSchema, response: channelMessageSchema, summary: '测试发送（仅发给本人）' }),
  audienceEstimate: op.post('/audience-estimate', { body: audienceEstimateSchema, response: channelAudienceEstimateSchema, summary: '预估群发受众人数' }),
  adminMessages: op.get('/admin/{id}/messages', { params: idParam, query: channelAdminMessageListQuery, response: paginated(channelMessageSchema), summary: '频道群发消息记录（含草稿 / 定时）' }),
  updateDraft: op.put('/admin/messages/{id}', { params: idParam, body: publishChannelSchema, response: channelMessageSchema, summary: '编辑草稿 / 定时消息' }),
  removeDraft: op.delete('/admin/messages/{id}', { params: idParam, summary: '删除草稿 / 取消定时' }),
  publishDraftNow: op.post('/admin/messages/{id}/publish', { params: idParam, response: channelMessageSchema, summary: '立即发送草稿 / 定时消息' }),
  retract: op.post('/admin/messages/{id}/retract', { params: idParam, summary: '撤回已发送的群发 / 客服消息' }),
  templates: op.get('/templates', { response: z.array(channelMessageTemplateSchema), summary: '群发消息模板列表' }),
  createTemplate: op.post('/templates', { body: createChannelTemplateSchema, response: channelMessageTemplateSchema, summary: '新建群发模板' }),
  updateTemplate: op.put('/templates/{id}', { params: idParam, body: updateChannelTemplateSchema, response: channelMessageTemplateSchema, summary: '编辑群发模板' }),
  removeTemplate: op.delete('/templates/{id}', { params: idParam, summary: '删除群发模板' }),
}, { tags: ['Channels'] });
