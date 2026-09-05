import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 分区包装：单项探测失败只标记不可用，不影响其他分区 */
function sectionOf<T extends z.ZodType>(data: T) {
  return z.object({
    available: z.boolean(),
    reason: z.string().nullable(),
    data: data.nullable(),
  });
}

export const opsOverviewHostSnapshotSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  uptimeSeconds: z.number(),
  cpuUsage: z.number(),
  cpuCores: z.number(),
  load1: z.number(),
  memUsagePercent: z.number(),
  memTotal: z.number(),
  memUsed: z.number(),
  diskUsagePercent: z.number().nullable(),
  diskTotal: z.number().nullable(),
  diskUsed: z.number().nullable(),
  diskMount: z.string().nullable(),
  databaseOk: z.boolean(),
  databaseConnections: z.number().nullable(),
  redisOk: z.boolean(),
}).meta({ id: 'OpsOverviewHostSnapshot' });

export type OpsOverviewHostSnapshot = z.infer<typeof opsOverviewHostSnapshotSchema>;

export const opsOverviewHostMatrixItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  address: z.string(),
  status: z.string(),
  snapshot: z.object({
    cpuCores: z.number().nullable(),
    load1: z.number().nullable(),
    memUsagePercent: z.number().nullable(),
    diskUsagePercent: z.number().nullable(),
  }).nullable(),
  probedAt: z.string().nullable(),
  probeError: z.string().nullable(),
}).meta({ id: 'OpsOverviewHostMatrixItem' });

export type OpsOverviewHostMatrixItem = z.infer<typeof opsOverviewHostMatrixItemSchema>;

export const opsOverviewSchema = z.object({
  host: sectionOf(opsOverviewHostSnapshotSchema),
  docker: sectionOf(z.object({ total: z.number(), running: z.number(), stopped: z.number() })),
  services: sectionOf(z.object({ total: z.number(), active: z.number(), failed: z.number() })),
  ssl: sectionOf(z.object({ total: z.number(), expiring: z.number(), expired: z.number() })),
  firewall: sectionOf(z.object({ type: z.string(), enabled: z.boolean() })),
  nginx: sectionOf(z.object({
    version: z.string().nullable(),
    running: z.boolean(),
    siteCount: z.number(),
    enabledCount: z.number(),
  })),
  terminals: sectionOf(z.object({ active: z.number() })),
  ports: sectionOf(z.object({ listening: z.number() })),
  hosts: sectionOf(z.array(opsOverviewHostMatrixItemSchema)),
  generatedAt: z.string(),
}).meta({ id: 'OpsOverview' });

export type OpsOverview = z.infer<typeof opsOverviewSchema>;

/** 概览分区载荷：`available=false` 时 `data` 为 null，`reason` 为探测失败原因 */
export type OpsOverviewSection<T> = { available: boolean; reason: string | null; data: T | null };

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const opsOverviewContract = defineContract('/api/ops-overview', {
  get: op.get('/', { response: opsOverviewSchema, summary: '运维概览聚合快照' }),
}, { tags: ['OpsOverview'] });
