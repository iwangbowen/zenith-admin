/**
 * 日志相关 DTO：登录日志、操作日志、统计
 */
import { z } from '@hono/zod-openapi';

export const LoginLogDTO = z
  .object({
    id: z.number().int(),
    userId: z.number().int().nullable(),
    username: z.string(),
    ip: z.string().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    status: z.enum(['success', 'fail']),
    message: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('LoginLog');

export const OperationLogDTO = z
  .object({
    id: z.number().int(),
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    module: z.string().nullable(),
    description: z.string(),
    method: z.string(),
    path: z.string(),
    requestBody: z.string().nullable(),
    beforeData: z.string().nullable(),
    afterData: z.string().nullable(),
    responseCode: z.number().int().nullable(),
    durationMs: z.number().int().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    os: z.string().nullable(),
    browser: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('OperationLog');

export const LogRowDTO = z
  .object({
    id: z.number().int(),
    userId: z.number().int().nullable().optional(),
    username: z.string().nullable().optional(),
    ip: z.string().nullable().optional(),
    status: z.string().optional(),
    message: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('LogRow');

export const OperationLogStatsDTO = z
  .object({
    moduleStats: z.array(z.object({ module: z.string(), count: z.number() })),
    dailyStats: z.array(z.object({ date: z.string(), count: z.number() })),
    userStats: z.array(z.object({ username: z.string(), count: z.number() })),
  })
  .openapi('OperationLogStats');
