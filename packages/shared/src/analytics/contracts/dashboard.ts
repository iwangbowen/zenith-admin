import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const dashboardStatsSchema = z.object({
  totalUsers: z.int(),
  onlineUsers: z.int().meta({ description: '近 5 分钟活跃的登录管理员数' }),
  todayLogins: z.int(),
  todayOperations: z.int(),
}).meta({ id: 'DashboardStats' });

export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const dashboardChartsSchema = z.object({
  loginTrend: z.array(z.object({ date: z.string(), successCount: z.number(), failCount: z.number() })),
  operationTypes: z.array(z.object({ module: z.string(), count: z.number() })),
}).meta({ id: 'DashboardCharts' });

export type DashboardCharts = z.infer<typeof dashboardChartsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const dashboardContract = defineContract('/api/dashboard', {
  stats: op.get('/stats', { access: 'authenticated', response: dashboardStatsSchema, summary: '仪表盘统计' }),
  charts: op.get('/charts', { access: 'authenticated', response: dashboardChartsSchema, summary: '仪表盘图表数据' }),
}, { tags: ['Dashboard'] });
