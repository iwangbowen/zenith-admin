/**
 * 服务器监控相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { monitorMetricValues } from '@zenith/shared';

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
      perCore: z
        .array(z.object({
          index: z.number().int(),
          usage: z.number(),
          user: z.number(),
          system: z.number(),
          idle: z.number(),
        }))
        .optional(),
    }),
    memory: z.object({
      total: z.number(),
      used: z.number(),
      free: z.number(),
      usagePercent: z.number(),
      detail: z
        .object({
          memTotal: z.number(),
          memFree: z.number(),
          memAvailable: z.number(),
          buffers: z.number(),
          cached: z.number(),
          shared: z.number(),
          swapTotal: z.number(),
          swapFree: z.number(),
          swapCached: z.number(),
          swapUsagePercent: z.number(),
          dirty: z.number(),
          writeback: z.number(),
        })
        .nullable()
        .optional(),
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
    disks: z
      .array(z.object({
        filesystem: z.string(),
        total: z.number(),
        used: z.number(),
        free: z.number(),
        usagePercent: z.number(),
        mount: z.string(),
      }))
      .optional(),
    network: z
      .array(z.object({
        name: z.string(),
        rxBytes: z.number(),
        txBytes: z.number(),
        rxBps: z.number(),
        txBps: z.number(),
        rxPackets: z.number(),
        txPackets: z.number(),
        rxErrors: z.number(),
        txErrors: z.number(),
      }))
      .optional(),
    diskIo: z
      .object({ readBps: z.number(), writeBps: z.number() })
      .optional(),
    topProcesses: z
      .object({
        byCpu: z.array(z.object({ pid: z.number().int(), name: z.string(), cpu: z.number(), memPercent: z.number(), memBytes: z.number() })),
        byMemory: z.array(z.object({ pid: z.number().int(), name: z.string(), cpu: z.number(), memPercent: z.number(), memBytes: z.number() })),
      })
      .nullable()
      .optional(),
    temperature: z
      .object({
        cpu: z.number().nullable(),
        sensors: z.array(z.object({ label: z.string(), celsius: z.number() })),
      })
      .nullable()
      .optional(),
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
        netRxBps: z.number().optional(),
        netTxBps: z.number().optional(),
        diskReadBps: z.number().optional(),
        diskWriteBps: z.number().optional(),
        dbConnections: z.number().optional(),
        redisMemBytes: z.number().optional(),
        redisHitRate: z.number().optional(),
      }),
    ),
  })
  .openapi('MonitorTimeseries');

export const MonitorWsDTO = z
  .object({
    currentConnections: z.number().int(),
    currentUsers: z.number().int(),
    totalConnects: z.number().int(),
    totalDisconnects: z.number().int(),
    totalSent: z.number().int(),
    totalRecv: z.number().int(),
    connections: z.array(
      z.object({
        tokenId: z.string(),
        userId: z.number().int(),
        username: z.string().nullable(),
        nickname: z.string().nullable(),
        connectedAt: z.number(),
        lastActivityAt: z.number(),
        sent: z.number().int(),
        recv: z.number().int(),
      }),
    ),
    recentDisconnects: z.array(
      z.object({
        tokenId: z.string(),
        userId: z.number().int(),
        username: z.string().nullable(),
        nickname: z.string().nullable(),
        at: z.number(),
        reason: z.string(),
        duration: z.number().int(),
        sent: z.number().int(),
        recv: z.number().int(),
      }),
    ),
  })
  .openapi('MonitorWs');

// ─── 历史时序（持久化，按桶聚合）────────────────────────────────────────
export const MonitorHistoryDTO = z
  .object({
    range: z.string(),
    bucketSec: z.number().int(),
    points: z.array(
      z.object({
        t: z.string(),
        cpu: z.number(),
        memory: z.number(),
        disk: z.number(),
        swap: z.number(),
        load1: z.number(),
        procCpu: z.number(),
        heap: z.number(),
        loopLag: z.number(),
        qps: z.number(),
        errorRate: z.number(),
        netRxBps: z.number(),
        netTxBps: z.number(),
        diskReadBps: z.number(),
        diskWriteBps: z.number(),
        cpuMax: z.number().optional(),
        memoryMax: z.number().optional(),
        diskMax: z.number().optional(),
        swapMax: z.number().optional(),
        load1Max: z.number().optional(),
        procCpuMax: z.number().optional(),
        heapMax: z.number().optional(),
        loopLagMax: z.number().optional(),
        qpsMax: z.number().optional(),
        errorRateMax: z.number().optional(),
        netRxBpsMax: z.number().optional(),
        netTxBpsMax: z.number().optional(),
        diskReadBpsMax: z.number().optional(),
        diskWriteBpsMax: z.number().optional(),
      }),
    ),
  })
  .openapi('MonitorHistory');

// ─── 监控告警规则 ───────────────────────────────────────────────────────
export const MonitorAlertRuleDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    metric: z.string(),
    operator: z.string(),
    threshold: z.number(),
    durationMinutes: z.number().int(),
    level: z.string(),
    channels: z.array(z.string()),
    webhookUrl: z.string().nullable(),
    recipients: z.array(z.string()),
    silenceMinutes: z.number().int(),
    enabled: z.boolean(),
    state: z.string(),
    lastTriggeredAt: z.string().nullable(),
    lastValue: z.number().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MonitorAlertRule');

// ─── 监控告警记录 ───────────────────────────────────────────────────────
export const MonitorAlertEventDTO = z
  .object({
    id: z.number().int(),
    ruleId: z.number().int().nullable(),
    ruleName: z.string(),
    metric: z.string(),
    level: z.string(),
    operator: z.string(),
    threshold: z.number(),
    value: z.number(),
    status: z.string(),
    message: z.string(),
    triggeredAt: z.string(),
    resolvedAt: z.string().nullable(),
  })
  .openapi('MonitorAlertEvent');

// ─── 请求体 DTO（与 shared validation 保持一致）─────────────────────────
const monitorMetricEnumDTO = z.enum(monitorMetricValues);
const monitorWebhookUrlDTO = z.url().max(512).refine(
  (value) => ['http:', 'https:'].includes(new URL(value).protocol),
  'Webhook URL 仅支持 HTTP/HTTPS',
);

const monitorAlertRuleInputDTO = z.object({
    name: z.string().min(1).max(128),
    metric: monitorMetricEnumDTO,
    operator: z.enum(['gt', 'gte', 'lt', 'lte']).default('gt'),
    threshold: z.number(),
    durationMinutes: z.number().int().min(0).max(1440).default(0),
    level: z.enum(['info', 'warning', 'critical']).default('warning'),
    channels: z.array(z.enum(['email', 'webhook', 'inapp'])).default([]),
    webhookUrl: monitorWebhookUrlDTO.nullable().optional(),
    recipients: z.array(z.string().max(128)).default([]),
    silenceMinutes: z.number().int().min(0).max(10_080).default(30),
    enabled: z.boolean().default(true),
  });

function validateMonitorAlertDelivery(
  value: { enabled?: boolean; channels?: string[]; webhookUrl?: string | null; recipients?: string[] },
  ctx: { addIssue: (issue: { code: 'custom'; path?: PropertyKey[]; message: string }) => void },
) {
  if (value.enabled === false) return;
  const channels = value.channels ?? [];
  if (channels.length === 0) ctx.addIssue({ code: 'custom', path: ['channels'], message: '启用告警时至少选择一个通知渠道' });
  if (channels.includes('webhook') && !value.webhookUrl) ctx.addIssue({ code: 'custom', path: ['webhookUrl'], message: 'Webhook 渠道必须配置有效 URL' });
  if ((channels.includes('email') || channels.includes('inapp')) && !(value.recipients?.length)) {
    ctx.addIssue({ code: 'custom', path: ['recipients'], message: '邮件或站内通知渠道必须配置接收人' });
  }
}

export const CreateMonitorAlertRuleDTO = monitorAlertRuleInputDTO
  .superRefine(validateMonitorAlertDelivery)
  .openapi('CreateMonitorAlertRule');
export const UpdateMonitorAlertRuleDTO = monitorAlertRuleInputDTO.partial().openapi('UpdateMonitorAlertRule');
