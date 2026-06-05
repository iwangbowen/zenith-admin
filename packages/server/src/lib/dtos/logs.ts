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
    location: z.string().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    userAgent: z.string().nullable(),
    status: z.enum(['success', 'fail']),
    message: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('LoginLog');

export const IpAccessLogDTO = z
  .object({
    id: z.number().int(),
    ip: z.string(),
    path: z.string(),
    method: z.string(),
    blockType: z.enum(['blacklist', 'whitelist']),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('IpAccessLog');

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
    responseBody: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    ip: z.string().nullable(),
    location: z.string().nullable(),
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
    summary: z.object({
      total: z.number(),
      successCount: z.number(),
      failCount: z.number(),
      avgDurationMs: z.number().nullable(),
      uniqueUsers: z.number(),
    }),
    moduleStats: z.array(z.object({ module: z.string(), count: z.number() })),
    dailyStats: z.array(z.object({ date: z.string(), count: z.number(), successCount: z.number(), failCount: z.number() })),
    userStats: z.array(z.object({ username: z.string(), count: z.number() })),
    methodStats: z.array(z.object({ method: z.string(), count: z.number() })),
    hourlyStats: z.array(z.object({ hour: z.number(), count: z.number() })),
  })
  .openapi('OperationLogStats');

export const LoginLogStatsDTO = z
  .object({
    summary: z.object({
      total: z.number(),
      successCount: z.number(),
      failCount: z.number(),
      uniqueUsers: z.number(),
    }),
    dailyStats: z.array(z.object({ date: z.string(), count: z.number(), successCount: z.number(), failCount: z.number() })),
    userStats: z.array(z.object({ username: z.string(), count: z.number() })),
    ipStats: z.array(z.object({ ip: z.string(), count: z.number() })),
    ipFailStats: z.array(z.object({ ip: z.string(), count: z.number() })),
    browserStats: z.array(z.object({ browser: z.string(), count: z.number() })),
    osStats: z.array(z.object({ os: z.string(), count: z.number() })),
    hourlyStats: z.array(z.object({ hour: z.number(), count: z.number() })),
  })
  .openapi('LoginLogStats');

export const LogFileDTO = z
  .object({
    name: z.string(),
    size: z.number(),
    modifiedAt: z.string(),
    isGzip: z.boolean(),
  })
  .openapi('LogFile');

export const LogFileContentDTO = z
  .object({
    lines: z.array(z.string()),
  })
  .openapi('LogFileContent');
