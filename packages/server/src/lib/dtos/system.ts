/**
 * 系统相关 DTO：系统配置、定时任务、邮件配置、密码策略、缓存、数据库备份、监控、在线会话
 */
import { z } from '@hono/zod-openapi';

export const SystemConfigDTO = z
  .object({
    id: z.number().int(),
    configKey: z.string().openapi({ example: 'site_title' }),
    configValue: z.string().openapi({ example: 'Zenith Admin' }),
    configType: z.enum(['string', 'number', 'boolean', 'json']),
    description: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SystemConfig');

export const CronJobDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '数据库备份' }),
    cronExpression: z.string().openapi({ example: '0 0 2 * * *' }),
    handler: z.string().openapi({ example: 'backupDatabase' }),
    params: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    description: z.string(),
    retryCount: z.number().int(),
    retryInterval: z.number().int(),
    monitorTimeout: z.number().int().nullable(),
    lastRunAt: z.string().nullable(),
    nextRunAt: z.string().nullable(),
    lastRunStatus: z.enum(['success', 'fail', 'running']).nullable(),
    lastRunMessage: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CronJob');

export const CronJobLogDTO = z
  .object({
    id: z.number().int(),
    jobId: z.number().int(),
    jobName: z.string(),
    executionCount: z.number().int(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    status: z.enum(['success', 'fail', 'running']),
    output: z.string().nullable(),
  })
  .openapi('CronJobLog');

export const EmailConfigDTO = z
  .object({
    id: z.number().int(),
    smtpHost: z.string().nullable().optional(),
    smtpPort: z.number().nullable().optional(),
    smtpUser: z.string().nullable().optional(),
    fromName: z.string().nullable().optional(),
    fromEmail: z.string().nullable().optional(),
    encryption: z.string().nullable().optional(),
    updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
    createdAt: z.union([z.string(), z.date()]).nullable().optional(),
  })
  .openapi('EmailConfig');

export const PasswordPolicyDTO = z
  .object({
    minLength: z.number().int(),
    requireUppercase: z.boolean(),
    requireSpecialChar: z.boolean(),
  })
  .openapi('PasswordPolicy');

export const PublicConfigDTO = z
  .object({
    configKey: z.string(),
    configValue: z.string().nullable(),
    configType: z.enum(['string', 'number', 'boolean', 'json']),
  })
  .openapi('PublicConfig');

export const CacheItemDTO = z
  .object({
    key: z.string(),
    displayKey: z.string(),
    segment: z.string(),
    category: z.string(),
    type: z.string(),
    ttl: z.number(),
    size: z.number(),
    value: z.string().nullable(),
  })
  .openapi('CacheItem');

export const DbBackupItemDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    type: z.enum(['pg_dump', 'drizzle_export']),
    fileId: z.number().int().nullable().optional(),
    fileSize: z.number().nullable().optional(),
    status: z.enum(['pending', 'running', 'success', 'failed']),
    tables: z.unknown().nullable().optional(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    durationMs: z.number().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    createdBy: z.number().int().nullable().optional(),
    createdByName: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('DbBackupItem');

export const MonitorDTO = z
  .object({
    os: z.object({
      platform: z.string(),
      release: z.string(),
      arch: z.string(),
      hostname: z.string(),
      uptimeSeconds: z.number().int(),
    }),
    cpu: z.object({
      model: z.string(),
      cores: z.number().int(),
      speed: z.number(),
      loadAvg: z.array(z.number()),
      usage: z.number(),
    }),
    memory: z.object({
      total: z.number(),
      used: z.number(),
      free: z.number(),
      usagePercent: z.number(),
    }),
    disk: z
      .object({
        total: z.number(),
        used: z.number(),
        free: z.number(),
        usagePercent: z.number(),
        mount: z.string().optional(),
      })
      .nullable(),
    node: z.object({
      version: z.string(),
      uptime: z.number().int(),
      pid: z.number().int(),
      memoryUsage: z.record(z.string(), z.number()),
      cpuUsagePercent: z.number().optional(),
      eventLoop: z
        .object({
          meanMs: z.number(),
          p50Ms: z.number(),
          p95Ms: z.number(),
          p99Ms: z.number(),
          maxMs: z.number(),
          stddevMs: z.number(),
        })
        .optional(),
      gc: z
        .object({
          totalCount: z.number(),
          totalDurationMs: z.number(),
          byKind: z.record(z.string(), z.object({ count: z.number(), durationMs: z.number() })),
        })
        .optional(),
      heapSpaces: z
        .array(z.object({ name: z.string(), size: z.number(), used: z.number(), available: z.number() }))
        .optional(),
      resourceUsage: z
        .object({
          userCPUMicros: z.number(),
          systemCPUMicros: z.number(),
          maxRssBytes: z.number(),
          fsRead: z.number(),
          fsWrite: z.number(),
          voluntaryContextSwitches: z.number(),
          involuntaryContextSwitches: z.number(),
        })
        .optional(),
    }),
    http: z
      .object({
        qps: z.number(),
        currentQps: z.number(),
        total: z.number(),
        errors: z.number(),
        errorRate: z.number(),
        total4xx: z.number(),
        total5xx: z.number(),
        p50: z.number(),
        p95: z.number(),
        p99: z.number(),
        max: z.number(),
      })
      .optional(),
    database: z.unknown().nullable(),
    redis: z.unknown().nullable(),
  })
  .openapi('MonitorInfo');

export const MonitorTimeseriesDTO = z
  .object({
    intervalSec: z.number().int(),
    capacity: z.number().int(),
    points: z.array(
      z.object({
        t: z.number(),
        cpu: z.number(),
        mem: z.number(),
        procCpu: z.number(),
        heap: z.number(),
        loopLagMean: z.number(),
        loopLagP99: z.number(),
        qps: z.number(),
        errorRate: z.number(),
      }),
    ),
  })
  .openapi('MonitorTimeseries');

export const OnlineSessionDTO = z
  .object({
    tokenId: z.string(),
    userId: z.number().int(),
    username: z.string(),
    nickname: z.string(),
    ip: z.string(),
    browser: z.string(),
    os: z.string(),
    loginAt: z.string(),
  })
  .openapi('OnlineSession');
