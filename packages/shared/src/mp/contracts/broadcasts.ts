import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MP_BROADCAST_STATUSES, MP_BROADCAST_TARGETS, MP_BROADCAST_TYPES } from '../constants';
import { createMpBroadcastSchema, previewMpBroadcastSchema, updateMpBroadcastSchema } from '../validation';
import { mpAccountIdQuery } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpBroadcastSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  msgType: z.enum(MP_BROADCAST_TYPES),
  target: z.enum(MP_BROADCAST_TARGETS),
  tagId: z.int().nullable().meta({ description: '按标签群发时的本地标签 ID' }),
  content: z.string().nullable(),
  mediaId: z.string().nullable(),
  status: z.enum(MP_BROADCAST_STATUSES),
  wechatMsgId: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  errorMsg: z.string().nullable(),
  sentAt: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpBroadcast' });

export type MpBroadcast = z.infer<typeof mpBroadcastSchema>;

/** 微信群发结果（mass/get）；计数字段仅在微信返回时存在 */
export const mpBroadcastResultSchema = z.object({
  msgStatus: z.string(),
  totalCount: z.int().optional(),
  filterCount: z.int().optional(),
  sentCount: z.int().optional(),
  errorCount: z.int().optional(),
}).meta({ id: 'MpBroadcastResult' });

export type MpBroadcastResult = z.infer<typeof mpBroadcastResultSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpBroadcastListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  status: z.enum(MP_BROADCAST_STATUSES).optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpBroadcastContract = defineContract('/api/mp/broadcasts', {
  list: op.get('/', { query: mpBroadcastListQuery, response: paginated(mpBroadcastSchema), summary: '群发列表' }),
  create: op.post('/', { body: createMpBroadcastSchema, response: mpBroadcastSchema, summary: '创建群发草稿' }),
  update: op.put('/{id}', { params: idParam, body: updateMpBroadcastSchema, response: mpBroadcastSchema, summary: '更新群发草稿' }),
  send: op.post('/{id}/send', { params: idParam, response: mpBroadcastSchema, summary: '发送群发' }),
  preview: op.post('/{id}/preview', { params: idParam, body: previewMpBroadcastSchema, summary: '群发预览（发给指定 openid）' }),
  result: op.get('/{id}/result', { params: idParam, response: mpBroadcastResultSchema, summary: '查询群发发送结果' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除群发' }),
}, { tags: ['公众号群发'] });
