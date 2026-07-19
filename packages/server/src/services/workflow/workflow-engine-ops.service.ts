/**
 * 工作流引擎运维：健康快照采集（platform-wide）+ 历史趋势 + 告警指标源 + 运维恢复动作。
 * - 采集由 pg-boss 定时任务调用，写入 workflow_engine_health_snapshots，供趋势图与告警评估器消费。
 * - 告警指标源（getLatestEngineHealthMetrics）被 monitor-alert 评估器读取（workflowHealth / workflowBacklog）。
 * - 运维动作复用现有恢复函数，全部为幂等恢复扫描。
 */
import { desc, gte, lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { workflowEngineHealthSnapshots } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import type {
  WorkflowEngineActionFilter,
  WorkflowEngineActionKey,
  WorkflowEngineActionPreview,
  WorkflowEngineActionResult,
  WorkflowEngineComponentStatus,
  WorkflowEngineHealthHistory,
  WorkflowEngineHealthPoint,
  WorkflowJobType,
} from '@zenith/shared';
import { getWorkflowEngineIntrospection, getWorkflowEngineThresholds, severityFromHealth } from './workflow-engine-introspection.service';

function backlogOf(queues: Array<{ ready: number; running: number; delayed: number; failed: number }>): number {
  return queues.reduce((sum, q) => sum + q.ready + q.running + q.delayed + q.failed, 0);
}

/**
 * 采集一次平台级引擎健康快照并落库。无请求上下文（systemWide），由定时任务调用。
 * 返回写入的健康分，便于任务日志摘要。
 */
export async function captureWorkflowEngineHealthSnapshot(): Promise<{ healthScore: number; severity: WorkflowEngineComponentStatus; backlog: number }> {
  const [snapshot, thresholds] = await Promise.all([
    getWorkflowEngineIntrospection(30, { systemWide: true }),
    getWorkflowEngineThresholds(),
  ]);
  const t = snapshot.telemetry;
  const backlog = backlogOf(snapshot.queues);
  const errorRate = t.events.last24h.total > 0 ? t.events.last24h.failed / t.events.last24h.total : 0;
  const severity = severityFromHealth(t.healthScore, thresholds);
  const criticalCount = snapshot.issues.filter((i) => i.severity === 'critical').length;
  const warningCount = snapshot.issues.filter((i) => i.severity === 'warning').length;

  await db.insert(workflowEngineHealthSnapshots).values({
    healthScore: t.healthScore,
    severity,
    backlog,
    errorRate,
    criticalCount,
    warningCount,
    runningInstances: snapshot.runtime.runningInstances,
  });

  return { healthScore: t.healthScore, severity, backlog };
}

/** 按保留小时数清理旧快照，默认 7 天。返回删除行数。 */
export async function cleanupWorkflowEngineHealthSnapshots(retentionHours = 24 * 7): Promise<number> {
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60_000);
  const deleted = await db.delete(workflowEngineHealthSnapshots).where(lt(workflowEngineHealthSnapshots.createdAt, cutoff)).returning({ id: workflowEngineHealthSnapshots.id });
  return deleted.length;
}

/** 定时任务入口：采集 + 周期性清理。 */
export async function runWorkflowEngineHealthCapture(): Promise<string> {
  const { healthScore, severity, backlog } = await captureWorkflowEngineHealthSnapshot();
  // 每次采集顺带做一次轻量清理（删除超期行，量很小）。
  await cleanupWorkflowEngineHealthSnapshots();
  return `引擎健康采集完成：健康分 ${healthScore} / ${severity} / 积压 ${backlog}`;
}

/**
 * 清理终态实例的执行 Token（默认保留 90 天）。
 * Token 随分支执行持续增长，终态实例的 token 仅供保留期内的 Trace / 诊断回放使用；
 * 超期后分批删除（每批 batchLimit），避免长事务锁表。返回删除总数。
 */
export async function cleanupTerminalInstanceTokens(retentionDays = 90, batchLimit = 5000, maxBatches = 20): Promise<number> {
  // sql 模板裸插值 Date 无列编码器会导致驱动序列化失败，需绑定格式化串并显式 cast
  const cutoffText = formatDateTime(new Date(Date.now() - retentionDays * 24 * 60 * 60_000));
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await db.execute(sql`
      DELETE FROM workflow_tokens
      WHERE id IN (
        SELECT wt.id FROM workflow_tokens wt
        JOIN workflow_instances wi ON wi.id = wt.instance_id
        WHERE wi.status IN ('approved', 'rejected', 'withdrawn', 'cancelled')
          AND wi.updated_at < ${cutoffText}::timestamp
        LIMIT ${batchLimit}
      )
    `);
    const deleted = (res as unknown as { rowCount?: number }).rowCount ?? 0;
    total += deleted;
    if (deleted < batchLimit) break;
  }
  return total;
}

/** 定时任务入口：终态实例 token 保留期清理。 */
export async function runWorkflowTokenCleanup(): Promise<string> {
  const deleted = await cleanupTerminalInstanceTokens();
  return `工作流 Token 清理完成：删除 ${deleted} 条终态实例超期 token`;
}

/** 读取近 N 小时健康趋势点（时间升序）。 */
export async function getWorkflowEngineHealthHistory(hours = 24): Promise<WorkflowEngineHealthHistory> {
  const safeHours = Math.max(1, Math.min(hours, 24 * 30));
  const since = new Date(Date.now() - safeHours * 60 * 60_000);
  const [rows, thresholds] = await Promise.all([
    db.select()
      .from(workflowEngineHealthSnapshots)
      .where(gte(workflowEngineHealthSnapshots.createdAt, since))
      .orderBy(workflowEngineHealthSnapshots.createdAt)
      .limit(5000),
    getWorkflowEngineThresholds(),
  ]);
  const points: WorkflowEngineHealthPoint[] = rows.map((row) => ({
    capturedAt: formatDateTime(row.createdAt),
    healthScore: row.healthScore,
    severity: (row.severity as WorkflowEngineComponentStatus) ?? 'healthy',
    backlog: row.backlog,
    errorRate: row.errorRate,
    criticalCount: row.criticalCount,
    warningCount: row.warningCount,
    runningInstances: row.runningInstances,
  }));
  return {
    points,
    thresholds: {
      healthWarn: thresholds.healthWarn,
      healthCritical: thresholds.healthCritical,
      backlogWarn: thresholds.backlogWarn,
      backlogCritical: thresholds.backlogCritical,
      errorRateWarn: thresholds.errorRateWarn,
      errorRateCritical: thresholds.errorRateCritical,
    },
  };
}

/**
 * 告警指标源：返回最新一条健康快照的 workflowHealth / workflowBacklog，
 * 供 monitor-alert 评估器读取。无快照时回退到健康态（100 / 0），避免误报。
 */
export async function getLatestEngineHealthMetrics(): Promise<{ workflowHealth: number; workflowBacklog: number }> {
  const [row] = await db.select({
    healthScore: workflowEngineHealthSnapshots.healthScore,
    backlog: workflowEngineHealthSnapshots.backlog,
  })
    .from(workflowEngineHealthSnapshots)
    .orderBy(desc(workflowEngineHealthSnapshots.createdAt))
    .limit(1);
  return { workflowHealth: row?.healthScore ?? 100, workflowBacklog: row?.backlog ?? 0 };
}

/** 各运维动作固定对应的作业类型（drain 时按类型细分，避免"全部只 drain 一遍"）。 */
const ACTION_META: Record<WorkflowEngineActionKey, { label: string; jobTypes: WorkflowJobType[] }> = {
  'replay-outbox': { label: '事件派发重放（作业账本）', jobTypes: ['event_dispatch'] },
  'recover-delays': { label: '延时任务兜底（作业账本）', jobTypes: ['delay_wake'] },
  'recover-subprocess': { label: '子流程兜底（作业账本）', jobTypes: ['subprocess_spawn', 'subprocess_join'] },
  'process-timeouts': { label: '超时任务兜底（作业账本）', jobTypes: ['task_timeout'] },
  'recover-triggers': { label: '触发器兜底（作业账本）', jobTypes: ['trigger_dispatch'] },
  'recover-webhooks': { label: 'Webhook 投递兜底（作业账本）', jobTypes: ['webhook_delivery'] },
};

const ACTION_LIMIT_DEFAULT = 200;
const ACTION_LIMIT_MAX = 500;
function clampActionLimit(value?: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return ACTION_LIMIT_DEFAULT;
  return Math.min(Math.floor(value), ACTION_LIMIT_MAX);
}

export function isWorkflowEngineActionKey(value: string): value is WorkflowEngineActionKey {
  return value in ACTION_META;
}

/**
 * 运维动作执行前预览：按 jobType（动作固定）+ 实例 / 入库时长筛选，
 * 统计将被处理的作业（到期 pending + 卡死 running）与未到期作业，并返回样本行。
 */
export async function previewWorkflowEngineAction(
  action: WorkflowEngineActionKey,
  filter?: WorkflowEngineActionFilter,
): Promise<WorkflowEngineActionPreview> {
  const meta = ACTION_META[action];
  const { previewDrainableJobs } = await import('../../lib/workflow-jobs');
  const preview = await previewDrainableJobs({
    jobTypes: meta.jobTypes,
    instanceId: filter?.instanceId,
    olderThanMinutes: filter?.olderThanMinutes,
    sampleLimit: 10,
  });
  return {
    action,
    label: meta.label,
    jobTypes: meta.jobTypes,
    duePending: preview.duePending,
    stuckRunning: preview.stuckRunning,
    scheduledLater: preview.scheduledLater,
    matched: preview.duePending + preview.stuckRunning,
    limit: clampActionLimit(filter?.limit),
    sample: preview.sample,
  };
}

/** 执行一项引擎运维恢复动作（幂等扫描，支持按实例 / 入库时长 / 上限筛选），返回统一结果。 */
export async function runWorkflowEngineAction(
  action: WorkflowEngineActionKey,
  filter?: WorkflowEngineActionFilter,
): Promise<WorkflowEngineActionResult> {
  const meta = ACTION_META[action];
  try {
    const { drainWorkflowJobs } = await import('../../lib/workflow-jobs');
    const r = await drainWorkflowJobs({
      jobTypes: meta.jobTypes,
      instanceId: filter?.instanceId,
      olderThanMinutes: filter?.olderThanMinutes,
      limit: clampActionLimit(filter?.limit),
    });
    const detail: Record<string, number> = { recovered: r.recovered, processed: r.processed };
    const summary = Object.entries(detail).map(([k, v]) => `${k} ${v}`).join(' · ');
    return { action, ok: true, message: `${meta.label}完成：${summary || '无待处理项'}`, detail };
  } catch (err) {
    logger.error('工作流引擎运维动作执行失败', { err, action });
    return { action, ok: false, message: `${meta.label}失败：${err instanceof Error ? err.message : String(err)}`, detail: {} };
  }
}
