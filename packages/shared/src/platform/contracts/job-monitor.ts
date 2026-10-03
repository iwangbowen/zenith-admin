import * as z from 'zod';
import { sectionOf } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { JOB_HEALTH_LEVELS, JOB_SOURCE_KEYS, JOB_MONITOR_TREND_RANGES, PROCESS_ROLES } from '../constants';

export const jobDrillDownSchema = z.object({ path: z.string(), label: z.string() });
export type JobDrillDown = z.infer<typeof jobDrillDownSchema>;
export const jobSourceIssueSchema = z.object({ level: z.enum(['warn', 'critical']), message: z.string() });
export const jobSourceCountsSchema = z.object({
  pending: z.int().nonnegative(), running: z.int().nonnegative(), stuck: z.int().nonnegative(),
  dead: z.int().nonnegative().nullable(), failed24h: z.int().nonnegative(), succeeded24h: z.int().nonnegative(),
});
export const jobSourceSummarySchema = z.object({
  key: z.enum(JOB_SOURCE_KEYS), title: z.string(), module: z.string(), health: z.enum(JOB_HEALTH_LEVELS),
  reason: z.string().nullable(), counts: jobSourceCountsSchema, oldestPendingAgeSec: z.int().nonnegative().nullable(),
  failureRate24h: z.number().min(0).max(1).nullable(), issues: z.array(jobSourceIssueSchema),
  drillDown: jobDrillDownSchema.nullable(), supportsStuckList: z.boolean(),
}).meta({ id: 'JobSourceSummary' });
export type JobSourceSummary = z.infer<typeof jobSourceSummarySchema>;
export const jobWorkerNodeSchema = z.object({
  nodeId: z.string(), hostname: z.string(), pid: z.int(), roles: z.array(z.enum(PROCESS_ROLES)),
  version: z.string().nullable(), lastHeartbeatAt: z.string(), runningJobCount: z.int().nonnegative(), stale: z.boolean(),
}).meta({ id: 'JobWorkerNode' });
export type JobWorkerNode = z.infer<typeof jobWorkerNodeSchema>;
export const jobQueueRowSchema = z.object({
  name: z.string(), title: z.string(), module: z.string(), queued: z.int().nonnegative(),
  active: z.int().nonnegative(), deferred: z.int().nonnegative(), failed: z.int().nonnegative(),
}).meta({ id: 'JobQueueRow' });
export type JobQueueRow = z.infer<typeof jobQueueRowSchema>;
export const jobMonitorOverviewSchema = z.object({
  health: z.enum(JOB_HEALTH_LEVELS), generatedAt: z.string(),
  totals: z.object({ backlog: z.int().nonnegative(), running: z.int().nonnegative(), stuck: z.int().nonnegative(), dead: z.int().nonnegative(), failed24h: z.int().nonnegative() }),
  workers: sectionOf(z.object({ total: z.int(), active: z.int(), stale: z.int(), workerRoleActive: z.int(), nodes: z.array(jobWorkerNodeSchema) })),
  queues: sectionOf(z.array(jobQueueRowSchema)), sources: z.array(jobSourceSummarySchema),
}).meta({ id: 'JobMonitorOverview' });
export type JobMonitorOverview = z.infer<typeof jobMonitorOverviewSchema>;
export const jobStuckItemSchema = z.object({
  source: z.enum(JOB_SOURCE_KEYS), refId: z.string(), title: z.string(), status: z.string(),
  startedAt: z.string().nullable(), lastSeenAt: z.string().nullable(), ageSec: z.int().nonnegative(),
  nodeId: z.string().nullable(), detail: z.string().nullable(), drillDown: jobDrillDownSchema.nullable(),
}).meta({ id: 'JobStuckItem' });
export type JobStuckItem = z.infer<typeof jobStuckItemSchema>;
export const jobMonitorTrendSchema = z.object({ points: z.array(z.object({
  time: z.string(), backlog: z.number().nullable(), stuck: z.number().nullable(), dead: z.number().nullable(), failed1h: z.number().nullable(),
})) }).meta({ id: 'JobMonitorTrend' });
export type JobMonitorTrend = z.infer<typeof jobMonitorTrendSchema>;
export const jobMonitorContract = defineContract('/api/job-monitor', {
  overview: op.get('/overview', { access: { permission: 'system:job-monitor:view' }, response: jobMonitorOverviewSchema, summary: '平台作业健康总览' }),
  stuck: op.get('/sources/{key}/stuck', { access: { permission: 'system:job-monitor:view' }, params: z.object({ key: z.enum(JOB_SOURCE_KEYS) }), query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), response: z.array(jobStuckItemSchema), summary: '作业源卡死明细' }),
  trend: op.get('/trend', { access: { permission: 'system:job-monitor:view' }, query: z.object({ range: z.enum(JOB_MONITOR_TREND_RANGES).default('24h') }), response: jobMonitorTrendSchema, summary: '作业监控历史趋势' }),
}, { tags: ['JobMonitor'] });
