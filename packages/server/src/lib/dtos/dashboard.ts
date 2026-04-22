/**
 * 仪表盘相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const DashboardStatsDTO = z
  .object({
    totalUsers: z.number().int(),
    activeUsers: z.number().int(),
    onlineUsers: z.number().int(),
    todayLogins: z.number().int(),
    todayOperations: z.number().int(),
  })
  .openapi('DashboardStats');

export const DashboardChartsDTO = z
  .object({
    loginTrend: z.array(
      z.object({ date: z.string(), successCount: z.number(), failCount: z.number() }),
    ),
    operationTypes: z.array(z.object({ module: z.string(), count: z.number() })),
    userActivity: z.array(z.object({ date: z.string(), activeUsers: z.number() })),
  })
  .openapi('DashboardCharts');
