/**
 * 日志相关 DTO：IP 拦截日志、操作日志统计、日志文件
 */
import { z } from '@hono/zod-openapi';
import { operationLogSchema } from '@zenith/shared/platform';

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

/** 操作日志实体：由 platform 契约定义，此处别名供尚未契约化的路由复用（同名组件只允许一个 schema 实例） */
export const OperationLogDTO = operationLogSchema;

export const OperationLogStatsDTO = z
  .object({
    summary: z.object({
      total: z.number(),
      successCount: z.number(),
      failCount: z.number(),
      avgDurationMs: z.number().nullable(),
      uniqueUsers: z.number(),
      p50DurationMs: z.number().nullable(),
      p95DurationMs: z.number().nullable(),
      p99DurationMs: z.number().nullable(),
    }),
    prevSummary: z.object({
      total: z.number(),
      successCount: z.number(),
      failCount: z.number(),
      avgDurationMs: z.number().nullable(),
      uniqueUsers: z.number(),
    }),
    moduleStats: z.array(z.object({ module: z.string(), count: z.number() })),
    moduleTimingStats: z.array(z.object({ module: z.string(), avgMs: z.number(), maxMs: z.number(), count: z.number() })),
    dailyStats: z.array(z.object({ date: z.string(), count: z.number(), successCount: z.number(), failCount: z.number(), avgMs: z.number().nullable() })),
    userStats: z.array(z.object({ username: z.string(), count: z.number() })),
    methodStats: z.array(z.object({ method: z.string(), count: z.number() })),
    hourlyStats: z.array(z.object({ hour: z.number(), count: z.number() })),
    statusClassStats: z.array(z.object({ statusClass: z.string(), count: z.number() })),
    durationHistogram: z.array(z.object({ bucket: z.string(), count: z.number() })),
    slowPaths: z.array(z.object({ path: z.string(), avgMs: z.number(), maxMs: z.number(), count: z.number() })),
    failModuleStats: z.array(z.object({ module: z.string(), count: z.number() })),
    userModuleFlows: z.array(z.object({ username: z.string(), module: z.string(), count: z.number() })),
  })
  .openapi('OperationLogStats');

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
