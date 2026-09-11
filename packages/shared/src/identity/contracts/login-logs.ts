import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { LOGIN_EVENT_TYPES, LOGIN_STATUSES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const loginLogSchema = z.object({
  id: z.int(),
  userId: z.int().nullable(),
  username: z.string(),
  nickname: z.string().nullable().optional().meta({ description: '用户当前昵称（按 username 关联补充；用户已删除时为 null）' }),
  ip: z.string().nullable(),
  location: z.string().nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  userAgent: z.string().nullable(),
  eventType: z.enum(LOGIN_EVENT_TYPES),
  status: z.enum(LOGIN_STATUSES),
  message: z.string().nullable(),
  tenantId: z.int().nullable().optional(),
  screenWidth: z.int().nullable().optional(),
  screenHeight: z.int().nullable().optional(),
  devicePixelRatio: z.string().nullable().optional(),
  gpu: z.string().nullable().optional(),
  cpuCores: z.int().nullable().optional(),
  memoryGb: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'LoginLog' });

export type LoginLog = z.infer<typeof loginLogSchema>;

const loginLogSummarySchema = z.object({
  total: z.number(),
  successCount: z.number(),
  failCount: z.number(),
  uniqueUsers: z.number(),
});

export const loginLogStatsSchema = z.object({
  summary: loginLogSummarySchema,
  prevSummary: loginLogSummarySchema.meta({ description: '上一周期（相同天数）汇总，用于环比' }),
  dailyStats: z.array(z.object({ date: z.string(), count: z.number(), successCount: z.number(), failCount: z.number() })),
  userStats: z.array(z.object({ username: z.string(), nickname: z.string().nullable().optional(), count: z.number() })),
  ipStats: z.array(z.object({ ip: z.string(), count: z.number() })),
  ipFailStats: z.array(z.object({ ip: z.string(), count: z.number() })),
  browserStats: z.array(z.object({ browser: z.string(), count: z.number() })),
  osStats: z.array(z.object({ os: z.string(), count: z.number() })),
  hourlyStats: z.array(z.object({ hour: z.number(), count: z.number() })),
  failReasonStats: z.array(z.object({ message: z.string(), count: z.number() })).meta({ description: '失败原因分布（按 message 分组）' }),
  locationStats: z.array(z.object({ location: z.string(), count: z.number() })).meta({ description: '登录地点 Top（IP 归属地）' }),
  dowHourStats: z.array(z.object({ dow: z.number(), hour: z.number(), count: z.number() })).meta({ description: '星期 × 小时活跃分布（dow: 1=周一 … 7=周日）' }),
  resolutionStats: z.array(z.object({ resolution: z.string(), count: z.number() })),
  gpuStats: z.array(z.object({ gpu: z.string(), count: z.number() })),
}).meta({ id: 'LoginLogStats' });

export type LoginLogStats = z.infer<typeof loginLogStatsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const loginLogListQuery = paginationQuery.extend({
  username: z.string().optional().meta({ description: '按用户名 / 昵称模糊匹配' }),
  eventType: queryEnum(LOGIN_EVENT_TYPES),
  status: queryEnum(LOGIN_STATUSES),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const loginLogStatsQuery = z.object({
  days: z.coerce.number().optional().meta({ description: '统计周期天数（7-365，默认 90）' }),
});

export const loginLogCleanQuery = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(180).meta({ description: '清除多少天之前的日志' }),
});

export const loginLogContract = defineContract('/api/login-logs', {
  list: op.get('/', { query: loginLogListQuery, response: paginated(loginLogSchema), summary: '登录日志分页查询' }),
  stats: op.get('/stats', { query: loginLogStatsQuery, response: loginLogStatsSchema, summary: '登录日志统计' }),
  clean: op.delete('/clean', { query: loginLogCleanQuery, summary: '清除登录日志' }),
}, { tags: ['LoginLogs'] });
