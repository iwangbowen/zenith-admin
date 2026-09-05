import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { BROADCAST_AUDIENCE_TYPES, BROADCAST_CHANNELS, BROADCAST_STATUSES } from '../constants';
import { createBroadcastSchema, updateBroadcastSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const broadcastCampaignSchema = z.object({
  id: z.int(),
  title: z.string(),
  content: z.string(),
  link: z.string().nullable().meta({ description: '点击深链（站内路由或外链）' }),
  channels: z.array(z.enum(BROADCAST_CHANNELS)).meta({ description: '投递渠道（映射 notify 的 channelPolicy.only）' }),
  audienceType: z.enum(BROADCAST_AUDIENCE_TYPES),
  audienceIds: z.array(z.int()).meta({ description: 'audienceType 为指定名单时的主体 ID 列表' }),
  status: z.enum(BROADCAST_STATUSES),
  totalRecipients: z.int().nullable().meta({ description: '受众解析后的总人数（发送时快照）' }),
  enqueuedCount: z.int().meta({ description: '已入队批次覆盖的人数' }),
  taskId: z.int().nullable().meta({ description: '关联的任务中心任务' }),
  sentAt: z.string().nullable(),
  remark: z.string().nullable(),
  createdBy: z.int().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'BroadcastCampaign' });

export type BroadcastCampaign = z.infer<typeof broadcastCampaignSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const broadcastListQuery = paginationQuery.extend({
  keyword: z.string().max(256).optional().meta({ description: '按标题 / 内容模糊匹配' }),
  status: z.enum(BROADCAST_STATUSES).optional(),
});

export const broadcastContract = defineContract('/api/broadcasts', {
  list: op.get('/', { query: broadcastListQuery, response: paginated(broadcastCampaignSchema), summary: '群发活动列表' }),
  detail: op.get('/{id}', { params: idParam, response: broadcastCampaignSchema, summary: '群发活动详情' }),
  create: op.post('/', { body: createBroadcastSchema, response: broadcastCampaignSchema, summary: '创建群发活动（草稿）' }),
  update: op.put('/{id}', { params: idParam, body: updateBroadcastSchema, response: broadcastCampaignSchema, summary: '更新群发活动（仅草稿 / 失败 / 已取消）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除群发活动' }),
  send: op.post('/{id}/send', { params: idParam, response: asyncTaskSchema, summary: '发送群发活动（提交任务中心分批派发）' }),
}, { tags: ['运营群发'] });
