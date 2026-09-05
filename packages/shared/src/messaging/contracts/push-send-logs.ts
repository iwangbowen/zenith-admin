import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PUSH_DELIVERY_STATUSES, PUSH_PROVIDERS, SEND_SOURCES, SEND_STATUSES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const pushSendLogSchema = z.object({
  id: z.int(),
  configId: z.int().nullable(),
  appId: z.int().nullable(),
  appName: z.string().nullable(),
  provider: z.enum(PUSH_PROVIDERS),
  subjectType: z.string().nullable().meta({ description: '收件主体类型（测试直发为 null）' }),
  subjectId: z.int().nullable(),
  subjectName: z.string().nullable().meta({ description: 'user 主体的昵称；member 主体为 null' }),
  deviceCount: z.int(),
  title: z.string(),
  content: z.string(),
  link: z.string().nullable(),
  eventKey: z.string().nullable(),
  status: z.enum(SEND_STATUSES),
  providerMsgId: z.string().nullable(),
  deliveryStatus: z.enum(PUSH_DELIVERY_STATUSES).nullable(),
  deliveredAt: z.string().nullable(),
  clickedAt: z.string().nullable(),
  errorMsg: z.string().nullable(),
  source: z.enum(SEND_SOURCES),
  tenantId: z.int().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'PushSendLog' });

export type PushSendLog = z.infer<typeof pushSendLogSchema>;

const pushSendLogCountersSchema = z.object({
  total: z.int(),
  success: z.int(),
  failed: z.int(),
  delivered: z.int().meta({ description: '收到送达回执的记录数' }),
  clicked: z.int().meta({ description: '收到点击回执的记录数' }),
});

/** 推送记录页顶部统计（窗口内汇总 + 按日趋势） */
export const pushSendLogStatsSchema = z.object({
  totals: pushSendLogCountersSchema,
  trend: z.array(pushSendLogCountersSchema.extend({ date: z.string() })),
}).meta({ id: 'PushSendLogStats' });

export type PushSendLogStats = z.infer<typeof pushSendLogStatsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const pushSendLogListQuery = paginationQuery.extend({
  keyword: z.string().max(256).optional().meta({ description: '按标题 / 内容 / 事件 key 模糊匹配' }),
  provider: z.enum(PUSH_PROVIDERS).optional(),
  status: z.enum(SEND_STATUSES).optional(),
  startTime: dateRangeBound('发送时间起'),
  endTime: dateRangeBound('发送时间止'),
});

export const pushSendLogStatsQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).default(14).meta({ description: '统计窗口天数' }),
});

export const pushSendLogContract = defineContract('/api/push-send-logs', {
  list: op.get('/', { query: pushSendLogListQuery, response: paginated(pushSendLogSchema), summary: '推送发送记录' }),
  stats: op.get('/stats', { query: pushSendLogStatsQuery, response: pushSendLogStatsSchema, summary: '推送统计（窗口汇总 + 按日趋势）' }),
}, { tags: ['推送管理'] });
