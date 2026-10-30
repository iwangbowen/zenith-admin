/**
 * 链路追踪查看器：按 traceId 聚合一次操作的全部留痕锚点为统一时间线。
 *
 * traceId = hono requestId（见 middleware/request-trace.ts 的合并说明）。
 * 五类锚点纯读聚合，无独立存储：
 *   request      ← operation_logs.request_id
 *   job           ← workflow_jobs.trace_id
 *   notification ← notification_outbox.trace_id + notification_dispatches（渠道级投递结果）
 *   task         ← async_tasks.trace_id
 */
import { and, count, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { TraceFailureEntry, TraceListEntry, TraceNodeKind, TraceNodeStatus, TraceTimeline, TraceTimelineNode } from '@zenith/shared/platform';
import { traceContract } from '@zenith/shared/platform';
import { db } from '../../db';
import {
  asyncTasks, notificationDispatches, notificationOutbox, operationLogs, workflowJobs,
} from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere } from '../../lib/where-helpers';
import { clampDays } from '../../lib/analytics-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';

const NODE_LIMIT_PER_KIND = 200;

const FAILURE_LIMIT_PER_SOURCE = 50;

const FAILURE_LIMIT_TOTAL = 50;

const RECENT_TRACE_LIMIT = 50;

/** 阶段 1：每个锚点采样的最近行数（收集候选 traceId，避免全表扫描） */
const RECENT_SAMPLE_PER_SOURCE = 200;

const JOB_STATUS_MAP: Record<string, TraceNodeStatus> = {
  pending: 'pending',
  running: 'running',
  succeeded: 'success',
  failed: 'failed',
  dead: 'failed',
  canceled: 'failed',
};

const OUTBOX_STATUS_MAP: Record<string, TraceNodeStatus> = {
  pending: 'pending',
  done: 'success',
  failed: 'failed',
};

const TASK_STATUS_MAP: Record<string, TraceNodeStatus> = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  failed: 'failed',
  cancelled: 'failed',
};

function requestNodes(rows: (typeof operationLogs.$inferSelect)[]): TraceTimelineNode[] {
  return rows.map((r) => ({
    kind: 'request' as const,
    ts: formatDateTime(r.createdAt),
    title: `${r.method} ${r.path}`,
    status: (r.responseCode ?? 200) < 400 ? 'success' as const : 'failed' as const,
    durationMs: r.durationMs ?? null,
    refId: r.id,
    detail: {
      description: r.description,
      module: r.module,
      username: r.username,
      responseCode: r.responseCode,
      ip: r.ip,
      requestBody: r.requestBody,
      hasDiff: Boolean(r.beforeData || r.afterData),
    },
  }));
}

function jobNodes(rows: (typeof workflowJobs.$inferSelect)[]): TraceTimelineNode[] {
  return rows.map((r) => {
    return {
      kind: 'job' as const,
      ts: formatDateTime(r.createdAt),
      title: r.jobType,
      status: JOB_STATUS_MAP[r.status] ?? 'pending',
      durationMs: null,
      refId: r.id,
      parentRef: r.parentRef ?? null,
      detail: {
        jobType: r.jobType,
        nodeKey: r.nodeKey,
        instanceId: r.instanceId,
        attempts: r.attempts,
        maxAttempts: r.maxAttempts,
        runAt: formatDateTime(r.runAt),
        lastError: r.lastError,
        result: r.result,
      },
    };
  });
}

function taskNodes(rows: (typeof asyncTasks.$inferSelect)[]): TraceTimelineNode[] {
  return rows.map((r) => ({
    kind: 'task' as const,
    ts: formatDateTime(r.createdAt),
    title: r.title,
    status: TASK_STATUS_MAP[r.status] ?? 'pending',
    durationMs: r.startedAt && r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
    refId: r.id,
    parentRef: r.parentRef ?? null,
    detail: {
      taskType: r.taskType,
      processedCount: r.processedCount,
      totalCount: r.totalCount,
      failedCount: r.failedCount,
      progressNote: r.progressNote,
      errorMessage: r.errorMessage,
      attempts: r.attempts,
    },
  }));
}

async function notificationNodes(traceId: string): Promise<TraceTimelineNode[]> {
  const user = currentUser();
  const outboxRows = await db.select().from(notificationOutbox)
    .where(buildWhere(eq(notificationOutbox.traceId, traceId), tenantCondition(notificationOutbox, user)))
    .orderBy(desc(notificationOutbox.id))
    .limit(NODE_LIMIT_PER_KIND);
  if (outboxRows.length === 0) return [];

  const dispatchRows = await db.select({
    outboxId: notificationDispatches.outboxId,
    channel: notificationDispatches.channel,
    decision: notificationDispatches.decision,
    reasonCode: notificationDispatches.reasonCode,
    recipientType: notificationDispatches.recipientType,
    recipientId: notificationDispatches.recipientId,
  }).from(notificationDispatches)
    .where(inArray(notificationDispatches.outboxId, outboxRows.map((r) => r.id)));

  const byOutbox = new Map<number, typeof dispatchRows>();
  for (const d of dispatchRows) {
    if (d.outboxId === null) continue;
    const list = byOutbox.get(d.outboxId) ?? [];
    list.push(d);
    byOutbox.set(d.outboxId, list);
  }

  return outboxRows.map((r) => ({
    kind: 'notification' as const,
    ts: formatDateTime(r.createdAt),
    title: r.eventKey,
    status: OUTBOX_STATUS_MAP[r.status] ?? 'pending',
    durationMs: null,
    refId: r.id,
    parentRef: r.parentRef ?? null,
    detail: {
      eventKey: r.eventKey,
      recipientCount: Array.isArray(r.recipients) ? r.recipients.length : 0,
      attempts: r.attempts,
      lastError: r.lastError,
      dispatches: (byOutbox.get(r.id) ?? []).map((d) => ({
        channel: d.channel,
        decision: d.decision,
        reasonCode: d.reasonCode,
        recipientType: d.recipientType,
        recipientId: d.recipientId,
      })),
    },
  }));
}

/** 按 traceId 聚合时间线（五类锚点并行查询，按时间升序归并） */
export async function getTraceTimeline(traceId: string): Promise<TraceTimeline> {
  const user = currentUser();
  const [logRows, jobRows, taskRows, notifNodes] = await Promise.all([
    db.select().from(operationLogs)
      .where(buildWhere(eq(operationLogs.requestId, traceId), tenantCondition(operationLogs, user)))
      .orderBy(desc(operationLogs.id))
      .limit(NODE_LIMIT_PER_KIND),
    db.select().from(workflowJobs)
      .where(buildWhere(eq(workflowJobs.traceId, traceId), tenantCondition(workflowJobs, user)))
      .orderBy(desc(workflowJobs.id))
      .limit(NODE_LIMIT_PER_KIND),
    db.select().from(asyncTasks)
      .where(buildWhere(eq(asyncTasks.traceId, traceId), tenantCondition(asyncTasks, user)))
      .orderBy(desc(asyncTasks.id))
      .limit(NODE_LIMIT_PER_KIND),
    notificationNodes(traceId),
  ]);

  const nodes = [
    ...requestNodes(logRows),
    ...jobNodes(jobRows),
    ...taskNodes(taskRows),
    ...notifNodes,
  ].sort((a, b) => a.ts.localeCompare(b.ts) || a.refId - b.refId);

  return { traceId, nodes };
}

// ─── 最近失败链路（排障入口：不知道 traceId 时从这里进）───────────────────────
/** 四类锚点的失败记录归一列表（每源限 50，合并倒序取前 50） */
export async function listRecentTraceFailures(q: QueryOutputOf<typeof traceContract.recentFailures>): Promise<TraceFailureEntry[]> {
  const user = currentUser();
  const days = clampDays(q.days, 7, 30);
  const since = new Date(Date.now() - days * 86_400_000);
  const want = (kind: TraceNodeKind) => !q.kind || q.kind === kind;

  const [logRows, jobRows, taskRows, outboxRows] = await Promise.all([
    want('request')
      ? db.select({
          id: operationLogs.id, requestId: operationLogs.requestId, method: operationLogs.method,
          path: operationLogs.path, description: operationLogs.description,
          responseCode: operationLogs.responseCode, createdAt: operationLogs.createdAt,
        }).from(operationLogs)
        .where(buildWhere(
          and(gte(operationLogs.responseCode, 500), isNotNull(operationLogs.requestId), gte(operationLogs.createdAt, since)),
          tenantCondition(operationLogs, user),
        ))
        .orderBy(desc(operationLogs.id))
        .limit(FAILURE_LIMIT_PER_SOURCE)
      : Promise.resolve([]),
    want('job')
      ? db.select({
          id: workflowJobs.id, traceId: workflowJobs.traceId, jobType: workflowJobs.jobType,
          status: workflowJobs.status, lastError: workflowJobs.lastError, createdAt: workflowJobs.createdAt,
        }).from(workflowJobs)
        .where(buildWhere(
          and(inArray(workflowJobs.status, ['failed', 'dead']), isNotNull(workflowJobs.traceId), gte(workflowJobs.createdAt, since)),
          tenantCondition(workflowJobs, user),
        ))
        .orderBy(desc(workflowJobs.id))
        .limit(FAILURE_LIMIT_PER_SOURCE)
      : Promise.resolve([]),
    want('task')
      ? db.select({
          id: asyncTasks.id, traceId: asyncTasks.traceId, title: asyncTasks.title,
          errorMessage: asyncTasks.errorMessage, createdAt: asyncTasks.createdAt,
        }).from(asyncTasks)
        .where(buildWhere(
          and(eq(asyncTasks.status, 'failed'), isNotNull(asyncTasks.traceId), gte(asyncTasks.createdAt, since)),
          tenantCondition(asyncTasks, user),
        ))
        .orderBy(desc(asyncTasks.id))
        .limit(FAILURE_LIMIT_PER_SOURCE)
      : Promise.resolve([]),
    want('notification')
      ? db.select({
          id: notificationOutbox.id, traceId: notificationOutbox.traceId, eventKey: notificationOutbox.eventKey,
          lastError: notificationOutbox.lastError, createdAt: notificationOutbox.createdAt,
        }).from(notificationOutbox)
        .where(buildWhere(
          and(eq(notificationOutbox.status, 'failed'), isNotNull(notificationOutbox.traceId), gte(notificationOutbox.createdAt, since)),
          tenantCondition(notificationOutbox, user),
        ))
        .orderBy(desc(notificationOutbox.id))
        .limit(FAILURE_LIMIT_PER_SOURCE)
      : Promise.resolve([]),
  ]);

  const entries: TraceFailureEntry[] = [
    ...logRows.map((r) => ({
      kind: 'request' as const, refId: r.id, traceId: r.requestId!,
      title: `${r.method} ${r.path}`, error: `${r.description}（HTTP ${r.responseCode}）`,
      ts: formatDateTime(r.createdAt),
    })),
    ...jobRows.map((r) => ({
      kind: 'job' as const, refId: r.id, traceId: r.traceId!,
      title: r.jobType, error: `${r.status === 'dead' ? '死信：' : ''}${r.lastError ?? '执行失败'}`,
      ts: formatDateTime(r.createdAt),
    })),
    ...taskRows.map((r) => ({
      kind: 'task' as const, refId: r.id, traceId: r.traceId!,
      title: r.title, error: r.errorMessage ?? '任务失败',
      ts: formatDateTime(r.createdAt),
    })),
    ...outboxRows.map((r) => ({
      kind: 'notification' as const, refId: r.id, traceId: r.traceId!,
      title: r.eventKey, error: r.lastError ?? '派发失败',
      ts: formatDateTime(r.createdAt),
    })),
  ];

  return entries
    .sort((a, b) => b.ts.localeCompare(a.ts) || b.refId - a.refId)
    .slice(0, FAILURE_LIMIT_TOTAL);
}

// ─── 最近链路（无 ID 浏览入口）───────────────────────────────────────
/** 阶段 1 候选：traceId → 最近活动时间 + 入口摘要（按锚点优先级取：请求 > 作业 > 任务 > 通知） */
interface TraceCandidate {
  traceId: string;
  ts: Date;
  title: string;
  titlePriority: number;
}

/** 请求节点的成功 / 失败由响应码派生（与 requestNodes 的 `?? 200` 口径一致） */
function requestStatus(code: number | null): TraceNodeStatus {
  return (code ?? 200) < 400 ? 'success' : 'failed';
}

/** 最近链路列表：两阶段查询——各锚点采样收集候选 traceId，再按 traceId 分组统计节点 / 失败 / 在途计数 */
export async function listRecentTraces(q: QueryOutputOf<typeof traceContract.recent>): Promise<TraceListEntry[]> {
  const user = currentUser();
  const days = clampDays(q.days, 7, 30);
  const since = new Date(Date.now() - days * 86_400_000);

  // 阶段 1：四类锚点各取最近一批行，合并出候选 traceId
  const [logRows, jobRows, taskRows, outboxRows] = await Promise.all([
    db.select({
      traceId: operationLogs.requestId, ts: operationLogs.createdAt,
      method: operationLogs.method, path: operationLogs.path,
    }).from(operationLogs)
      .where(buildWhere(
        and(isNotNull(operationLogs.requestId), gte(operationLogs.createdAt, since)),
        tenantCondition(operationLogs, user),
      ))
      .orderBy(desc(operationLogs.id))
      .limit(RECENT_SAMPLE_PER_SOURCE),
    db.select({
      traceId: workflowJobs.traceId, ts: workflowJobs.createdAt, jobType: workflowJobs.jobType,
    }).from(workflowJobs)
      .where(buildWhere(
        and(isNotNull(workflowJobs.traceId), gte(workflowJobs.createdAt, since)),
        tenantCondition(workflowJobs, user),
      ))
      .orderBy(desc(workflowJobs.id))
      .limit(RECENT_SAMPLE_PER_SOURCE),
    db.select({
      traceId: asyncTasks.traceId, ts: asyncTasks.createdAt, title: asyncTasks.title,
    }).from(asyncTasks)
      .where(buildWhere(
        and(isNotNull(asyncTasks.traceId), gte(asyncTasks.createdAt, since)),
        tenantCondition(asyncTasks, user),
      ))
      .orderBy(desc(asyncTasks.id))
      .limit(RECENT_SAMPLE_PER_SOURCE),
    db.select({
      traceId: notificationOutbox.traceId, ts: notificationOutbox.createdAt, eventKey: notificationOutbox.eventKey,
    }).from(notificationOutbox)
      .where(buildWhere(
        and(isNotNull(notificationOutbox.traceId), gte(notificationOutbox.createdAt, since)),
        tenantCondition(notificationOutbox, user),
      ))
      .orderBy(desc(notificationOutbox.id))
      .limit(RECENT_SAMPLE_PER_SOURCE),
  ]);

  const candidates = new Map<string, TraceCandidate>();
  const addCandidate = (traceId: string, ts: Date, title: string, titlePriority: number) => {
    const cur = candidates.get(traceId);
    if (!cur) {
      candidates.set(traceId, { traceId, ts, title, titlePriority });
      return;
    }
    if (ts > cur.ts) cur.ts = ts;
    if (titlePriority < cur.titlePriority) {
      cur.title = title;
      cur.titlePriority = titlePriority;
    }
  };
  for (const r of logRows) addCandidate(r.traceId!, r.ts, `${r.method} ${r.path}`, 0);
  for (const r of jobRows) addCandidate(r.traceId!, r.ts, r.jobType, 1);
  for (const r of taskRows) addCandidate(r.traceId!, r.ts, r.title, 2);
  for (const r of outboxRows) addCandidate(r.traceId!, r.ts, r.eventKey, 3);

  const top = [...candidates.values()]
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())
    .slice(0, RECENT_TRACE_LIMIT);
  if (top.length === 0) return [];
  const ids = top.map((c) => c.traceId);

  // 阶段 2：按 traceId 分组统计节点状态分布（与时间线的 *_STATUS_MAP 同一口径，不重复定义状态清单）
  const [logCounts, jobCounts, taskCounts, outboxCounts] = await Promise.all([
    db.select({ traceId: operationLogs.requestId, bucket: operationLogs.responseCode, n: count() })
      .from(operationLogs)
      .where(buildWhere(inArray(operationLogs.requestId, ids), tenantCondition(operationLogs, user)))
      .groupBy(operationLogs.requestId, operationLogs.responseCode),
    db.select({ traceId: workflowJobs.traceId, bucket: workflowJobs.status, n: count() })
      .from(workflowJobs)
      .where(buildWhere(inArray(workflowJobs.traceId, ids), tenantCondition(workflowJobs, user)))
      .groupBy(workflowJobs.traceId, workflowJobs.status),
    db.select({ traceId: asyncTasks.traceId, bucket: asyncTasks.status, n: count() })
      .from(asyncTasks)
      .where(buildWhere(inArray(asyncTasks.traceId, ids), tenantCondition(asyncTasks, user)))
      .groupBy(asyncTasks.traceId, asyncTasks.status),
    db.select({ traceId: notificationOutbox.traceId, bucket: notificationOutbox.status, n: count() })
      .from(notificationOutbox)
      .where(buildWhere(inArray(notificationOutbox.traceId, ids), tenantCondition(notificationOutbox, user)))
      .groupBy(notificationOutbox.traceId, notificationOutbox.status),
  ]);

  const stats = new Map<string, { nodeCount: number; failedCount: number; running: boolean; pending: boolean }>();
  const bump = (traceId: string | null, status: TraceNodeStatus, n: number) => {
    if (!traceId) return;
    const s = stats.get(traceId) ?? { nodeCount: 0, failedCount: 0, running: false, pending: false };
    s.nodeCount += n;
    if (status === 'failed') s.failedCount += n;
    if (status === 'running') s.running = true;
    if (status === 'pending') s.pending = true;
    stats.set(traceId, s);
  };
  for (const r of logCounts) bump(r.traceId, requestStatus(r.bucket), r.n);
  for (const r of jobCounts) bump(r.traceId, JOB_STATUS_MAP[r.bucket] ?? 'pending', r.n);
  for (const r of taskCounts) bump(r.traceId, TASK_STATUS_MAP[r.bucket] ?? 'pending', r.n);
  for (const r of outboxCounts) bump(r.traceId, OUTBOX_STATUS_MAP[r.bucket] ?? 'pending', r.n);

  return top.map((c) => {
    const s = stats.get(c.traceId) ?? { nodeCount: 0, failedCount: 0, running: false, pending: false };
    return {
      traceId: c.traceId,
      ts: formatDateTime(c.ts),
      title: c.title,
      status: s.failedCount > 0 ? 'failed' as const
        : s.running ? 'running' as const
          : s.pending ? 'pending' as const
            : 'success' as const,
      nodeCount: s.nodeCount,
      failedCount: s.failedCount,
    };
  });
}
