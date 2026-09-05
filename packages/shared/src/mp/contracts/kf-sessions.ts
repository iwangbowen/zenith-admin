import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  acceptMpKfSessionSchema,
  closeMpKfSessionSchema,
  rateMpKfSessionSchema,
  replyMpKfSessionSchema,
} from '../../platform/validation';
import {
  MP_KF_ROUTING_STRATEGIES,
  MP_KF_SESSION_CLOSE_REASONS,
  MP_KF_SESSION_EVENT_TYPES,
  MP_KF_SESSION_STATUSES,
} from '../constants';
import { transferMpKfSessionSchema, updateMpKfRoutingConfigSchema } from '../validation';
import { mpAccountIdQuery } from './common';
import { mpMessageSchema } from './messages';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 多客服会话（状态机：waiting → active → closed） */
export const mpKfSessionSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  openid: z.string(),
  kfId: z.int().nullable(),
  kfNickname: z.string().nullable().meta({ description: '承接客服昵称（联表）' }),
  fanNickname: z.string().nullable().meta({ description: '粉丝昵称（联表）' }),
  fanAvatar: z.string().nullable(),
  status: z.enum(MP_KF_SESSION_STATUSES),
  priority: z.int(),
  source: z.string().nullable(),
  unreadCount: z.int(),
  lastFanMsgAt: z.string().nullable(),
  lastKfMsgAt: z.string().nullable(),
  lastMsgAt: z.string().nullable(),
  waitingSince: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  closeReason: z.enum(MP_KF_SESSION_CLOSE_REASONS).nullable(),
  rating: z.int().nullable(),
  ratingRemark: z.string().nullable(),
  remark: z.string().nullable(),
  waitSeconds: z.int().optional().meta({ description: '已等待秒数（仅 waiting 状态返回）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpKfSession' });

export type MpKfSession = z.infer<typeof mpKfSessionSchema>;

export const mpKfSessionEventSchema = z.object({
  id: z.int(),
  sessionId: z.int(),
  accountId: z.int(),
  type: z.enum(MP_KF_SESSION_EVENT_TYPES),
  fromKfId: z.int().nullable(),
  toKfId: z.int().nullable(),
  fromKfNickname: z.string().nullable(),
  toKfNickname: z.string().nullable(),
  operatorId: z.int().nullable(),
  operatorName: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'MpKfSessionEvent' });

export type MpKfSessionEvent = z.infer<typeof mpKfSessionEventSchema>;

/** 会话详情：会话 + 事件时间线 + 最近 50 条消息 */
export const mpKfSessionDetailSchema = mpKfSessionSchema.extend({
  events: z.array(mpKfSessionEventSchema),
  messages: z.array(mpMessageSchema),
}).meta({ id: 'MpKfSessionDetail' });

export type MpKfSessionDetail = z.infer<typeof mpKfSessionDetailSchema>;

export const mpKfRoutingConfigSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  enabled: z.boolean(),
  strategy: z.enum(MP_KF_ROUTING_STRATEGIES),
  maxConcurrent: z.int(),
  waitTimeoutMinutes: z.int(),
  idleTimeoutMinutes: z.int(),
  autoCloseEnabled: z.boolean(),
  welcomeText: z.string().nullable(),
  updatedAt: z.string(),
}).meta({ id: 'MpKfRoutingConfig' });

export type MpKfRoutingConfig = z.infer<typeof mpKfRoutingConfigSchema>;

export const mpKfAgentLoadSchema = z.object({
  kfId: z.int(),
  kfAccount: z.string(),
  nickname: z.string(),
  status: entityStatusSchema,
  activeCount: z.int(),
}).meta({ id: 'MpKfAgentLoad' });

export type MpKfAgentLoad = z.infer<typeof mpKfAgentLoadSchema>;

export const mpKfSessionStatsSchema = z.object({
  waiting: z.int(),
  active: z.int(),
  closedToday: z.int(),
  avgWaitSeconds: z.int().meta({ description: '今日已结束会话平均等待接入秒数' }),
  avgRating: z.number().meta({ description: '今日已结束会话平均满意度评分（1-5）' }),
  agents: z.array(mpKfAgentLoadSchema),
}).meta({ id: 'MpKfSessionStats' });

export type MpKfSessionStats = z.infer<typeof mpKfSessionStatsSchema>;

export const mpKfSessionReportItemSchema = z.object({
  date: z.string(),
  created: z.int(),
  closed: z.int(),
  avgWaitSeconds: z.int(),
  avgRating: z.number(),
}).meta({ id: 'MpKfSessionReport' });

export type MpKfSessionReportItem = z.infer<typeof mpKfSessionReportItemSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpKfSessionListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  status: z.enum(MP_KF_SESSION_STATUSES).optional(),
  kfId: z.coerce.number().int().positive().optional().meta({ description: '按承接客服筛选' }),
  keyword: z.string().optional().meta({ description: '按 openid / 粉丝昵称模糊匹配' }),
});

export const mpKfSessionReportQuery = mpAccountIdQuery.extend({
  days: z.coerce.number().int().min(1).max(31).default(7).meta({ description: '统计最近 N 天' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpKfSessionContract = defineContract('/api/mp/kf-sessions', {
  list: op.get('/', { query: mpKfSessionListQuery, response: paginated(mpKfSessionSchema), summary: '会话列表（工作台）' }),
  stats: op.get('/stats', { query: mpAccountIdQuery, response: mpKfSessionStatsSchema, summary: '会话概览统计' }),
  report: op.get('/report', { query: mpKfSessionReportQuery, response: z.array(mpKfSessionReportItemSchema), summary: '会话数据报表（近 N 天）' }),
  config: op.get('/config', { query: mpAccountIdQuery, response: mpKfRoutingConfigSchema, summary: '获取路由治理配置' }),
  updateConfig: op.put('/config', { query: mpAccountIdQuery, body: updateMpKfRoutingConfigSchema, response: mpKfRoutingConfigSchema, summary: '保存路由治理配置' }),
  detail: op.get('/{id}', { params: idParam, response: mpKfSessionDetailSchema, summary: '会话详情（含消息与事件时间线）' }),
  accept: op.post('/{id}/accept', { params: idParam, body: acceptMpKfSessionSchema, response: mpKfSessionSchema, summary: '接入会话' }),
  transfer: op.post('/{id}/transfer', { params: idParam, body: transferMpKfSessionSchema, response: mpKfSessionSchema, summary: '转接会话' }),
  close: op.post('/{id}/close', { params: idParam, body: closeMpKfSessionSchema, response: mpKfSessionSchema, summary: '结束会话' }),
  reply: op.post('/{id}/reply', { params: idParam, body: replyMpKfSessionSchema, response: mpKfSessionSchema, summary: '会话内回复粉丝' }),
  rate: op.post('/{id}/rate', { params: idParam, body: rateMpKfSessionSchema, response: mpKfSessionSchema, summary: '记录会话满意度' }),
}, { tags: ['公众号多客服会话'] });
