import { workflowEngineContract } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
import { percentOf } from '@zenith/shared/core';
import { WORKFLOW_JOB_TYPES, summarizeWorkflowJobChain } from '@zenith/shared/workflow';
import { and, asc, avg, count, desc, eq, gte, inArray, isNotNull, lte, max } from 'drizzle-orm';
import { db } from '../../db';
import { workflowJobs, workflowJobExecutions, workflowInstances, workflowDefinitions, systemSchedulerNodes } from '../../db/schema';
import type { WorkflowJobRow, WorkflowJobExecutionRow } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { retryJob, skipJob } from '../../lib/workflow-jobs/engine';
import { expiredWorkflowJobCondition } from '../../lib/workflow-jobs/engine';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';

function mapJob(row: WorkflowJobRow, extra?: { instanceTitle?: string | null; definitionName?: string | null }) {
  return {
    id: row.id,
    jobType: row.jobType,
    status: row.status,
    instanceId: row.instanceId ?? null,
    instanceTitle: extra?.instanceTitle ?? null,
    definitionName: extra?.definitionName ?? null,
    taskId: row.taskId ?? null,
    nodeKey: row.nodeKey ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    traceId: row.traceId ?? null,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    generation: row.generation,
    executionTimeoutMs: row.executionTimeoutMs,
    runAt: formatDateTime(row.runAt),
    lockedAt: formatNullableDateTime(row.lockedAt),
    lockedBy: row.lockedBy ?? null,
    leaseUntil: formatNullableDateTime(row.leaseUntil),
    executionDeadline: formatNullableDateTime(row.executionDeadline),
    lastError: row.lastError ?? null,
    result: (row.result ?? null) as Record<string, unknown> | null,
    tenantId: row.tenantId ?? null,
    ...formatTimestamps(row),
  };
}

function mapExecution(row: WorkflowJobExecutionRow) {
  return {
    id: row.id,
    jobId: row.jobId,
    jobType: row.jobType,
    attempt: row.attempt,
    generation: row.generation,
    status: row.status,
    requestUrl: row.requestUrl ?? null,
    requestMethod: row.requestMethod ?? null,
    requestBody: row.requestBody ?? null,
    responseStatus: row.responseStatus ?? null,
    responseBody: row.responseBody ?? null,
    errorMessage: row.errorMessage ?? null,
    durationMs: row.durationMs ?? null,
    startedAt: formatNullableDateTime(row.startedAt),
    finishedAt: formatNullableDateTime(row.finishedAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listWorkflowJobs(query: QueryOutputOf<typeof workflowEngineContract.jobs>) {
  const { page, pageSize } = query;
  const where = buildWhere(
    query.jobType ? eq(workflowJobs.jobType, query.jobType) : undefined,
    query.status ? eq(workflowJobs.status, query.status) : undefined,
    query.instanceId != null ? eq(workflowJobs.instanceId, query.instanceId) : undefined,
    keywordCondition(query.keyword, [workflowJobs.idempotencyKey, workflowJobs.traceId, workflowJobs.nodeKey], 'ilike'),
  );

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowJobs, where),
    rows: () => db.select({ job: workflowJobs, instanceTitle: workflowInstances.title, definitionName: workflowDefinitions.name })
      .from(workflowJobs)
      .leftJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .where(where)
      .orderBy(desc(workflowJobs.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: (r) => mapJob(r.job, { instanceTitle: r.instanceTitle, definitionName: r.definitionName }),
  });
}

export async function getWorkflowJobDetail(id: number) {
  const [row] = await db.select({ job: workflowJobs, instanceTitle: workflowInstances.title, definitionName: workflowDefinitions.name })
    .from(workflowJobs)
    .leftJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .where(eq(workflowJobs.id, id))
    .limit(1);
  requireRow(row, '作业不存在');
  const execs = await db.select().from(workflowJobExecutions)
    .where(eq(workflowJobExecutions.jobId, id))
    .orderBy(desc(workflowJobExecutions.id));
  return { ...mapJob(row.job, { instanceTitle: row.instanceTitle, definitionName: row.definitionName }), executions: execs.map(mapExecution) };
}

/**
 * 链路视图：返回同一 traceId 关联的全部作业（按创建时间升序，即一次操作触发的完整异步 fan-out，
 * 含跨实例/子流程串联）+ 每个作业的执行明细 + 状态统计。
 */
export async function getWorkflowJobChain(traceId: string) {
  const rows = await db.select({ job: workflowJobs, instanceTitle: workflowInstances.title, definitionName: workflowDefinitions.name })
    .from(workflowJobs)
    .leftJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .where(eq(workflowJobs.traceId, traceId))
    .orderBy(asc(workflowJobs.createdAt), asc(workflowJobs.id));
  const jobIds = rows.map((r) => r.job.id);
  const execs = jobIds.length > 0
    ? await db.select().from(workflowJobExecutions).where(inArray(workflowJobExecutions.jobId, jobIds)).orderBy(asc(workflowJobExecutions.id))
    : [];
  const execByJob = new Map<number, WorkflowJobExecutionRow[]>();
  for (const e of execs) {
    const list = execByJob.get(e.jobId) ?? [];
    list.push(e);
    execByJob.set(e.jobId, list);
  }
  const jobs = rows.map((r) => ({
    ...mapJob(r.job, { instanceTitle: r.instanceTitle, definitionName: r.definitionName }),
    executions: (execByJob.get(r.job.id) ?? []).map(mapExecution),
  }));
  return { traceId, jobs, stats: summarizeWorkflowJobChain(jobs) };
}

export async function retryWorkflowJob(id: number, payload?: Record<string, unknown>) {
  const row = await retryJob(id, payload ? { payload } : undefined);
  return mapJob(requireRow(row, '仅失败 / 死信 / 已取消的作业可重试', 400));
}

export async function skipWorkflowJob(id: number) {
  const row = await skipJob(id);
  return mapJob(requireRow(row, '仅待处理 / 运行中 / 已暂停 / 失败 / 死信的作业可跳过', 400));
}

export interface WorkflowJobBatchResult {
  total: number;
  /** 成功提交操作的数量，不表示作业已执行完成 */
  success: number;
  /** 因状态不满足而跳过的数量 */
  skipped: number;
}

/** 重放限流默认值：默认 20 条/秒错峰入队，单次最多 500 条，避免瞬时涌入压垮连接器/DB。 */
export const REPLAY_DEFAULTS = { ratePerSecond: 20, maxBatch: 500, maxRatePerSecond: 200 } as const;

export function clampRate(v?: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return REPLAY_DEFAULTS.ratePerSecond;
  return Math.min(Math.max(n, 1), REPLAY_DEFAULTS.maxRatePerSecond);
}

export function clampLimit(v?: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return REPLAY_DEFAULTS.maxBatch;
  return Math.min(Math.max(n, 1), REPLAY_DEFAULTS.maxBatch);
}

/** 错峰入队时间：第 index 个作业延后 floor(index / ratePerSecond) 秒（纯函数，便于测试）。 */
export function staggeredRunAt(index: number, ratePerSecond: number, fromMs: number): Date {
  return new Date(fromMs + Math.floor(index / Math.max(1, ratePerSecond)) * 1000);
}

/**
 * 按速率错峰重试一批作业：第 i 个作业的 runAt = now + floor(i / ratePerSecond) 秒，
 * 让 pg-boss pickup 与下游连接器/DB 压力平摊到时间窗内，而非全部立即入队。
 */
async function throttledRetry(ids: number[], ratePerSecond: number): Promise<number> {
  const from = Date.now();
  let success = 0;
  for (let i = 0; i < ids.length; i += 1) {
    if (await retryJob(ids[i], { runAt: staggeredRunAt(i, ratePerSecond, from) })) success += 1;
  }
  return success;
}

export interface WorkflowJobBatchRetryOptions { ratePerSecond?: number }

/** 批量重试：按速率错峰逐个 retryJob，不满足条件（非 failed/dead/canceled）计入 skipped。 */
export async function batchRetryWorkflowJobs(ids: number[], opts?: WorkflowJobBatchRetryOptions): Promise<WorkflowJobBatchResult> {
  const success = await throttledRetry(ids, clampRate(opts?.ratePerSecond));
  return { total: ids.length, success, skipped: ids.length - success };
}

/** 批量跳过：逐个调用 skipJob，不满足条件（非 pending/failed/dead）计入 skipped。 */
export async function batchSkipWorkflowJobs(ids: number[]): Promise<WorkflowJobBatchResult> {
  let success = 0;
  for (const id of ids) {
    const row = await skipJob(id);
    if (row) success += 1;
  }
  return { total: ids.length, success, skipped: ids.length - success };
}

interface WorkflowJobSummaryItem {
  jobType: WorkflowJobRow['jobType'];
  total: number;
  pending: number;
  running: number;
  paused: number;
  succeeded: number;
  failed: number;
  dead: number;
  canceled: number;
}

/** 按作业类型 + 状态聚合计数，零填充全部注册类型，供作业账本 Tab 徽标使用。 */
export async function getWorkflowJobsSummary(): Promise<WorkflowJobSummaryItem[]> {
  const rows = await db
    .select({ jobType: workflowJobs.jobType, status: workflowJobs.status, c: count() })
    .from(workflowJobs)
    .groupBy(workflowJobs.jobType, workflowJobs.status);

  const map = new Map<WorkflowJobRow['jobType'], WorkflowJobSummaryItem>();
  for (const t of WORKFLOW_JOB_TYPES) {
    map.set(t, { jobType: t, total: 0, pending: 0, running: 0, paused: 0, succeeded: 0, failed: 0, dead: 0, canceled: 0 });
  }
  for (const r of rows) {
    const item = map.get(r.jobType);
    if (!item) continue;
    const n = Number(r.c);
    item.total += n;
    item[r.status] += n;
  }
  return WORKFLOW_JOB_TYPES.map((t) => map.get(t)!);
}

/** 死信重放过滤条件：多维（jobType/实例/traceId/错误原因/入库时长）精准圈定要重放的作业。 */
export interface WorkflowJobReplayFilter {
  /** 目标状态，默认 dead（死信），也可重放 failed */
  status?: 'dead' | 'failed';
  jobType?: WorkflowJobRow['jobType'];
  instanceId?: number;
  traceId?: string;
  /** 错误原因关键字，对 lastError 模糊匹配（用于对某聚类簇重放） */
  reasonKeyword?: string;
  /** 仅重放入库超过 N 分钟的作业，避免把刚失败还在退避窗内的一并冲入 */
  olderThanMinutes?: number;
}

/** 死信重放的圈定条件（预览与执行共用同一口径） */
function replayJobsWhere(filter: WorkflowJobReplayFilter) {
  return buildWhere(
    eq(workflowJobs.status, filter.status ?? 'dead'),
    filter.jobType ? eq(workflowJobs.jobType, filter.jobType) : undefined,
    filter.instanceId != null ? eq(workflowJobs.instanceId, filter.instanceId) : undefined,
    filter.traceId ? eq(workflowJobs.traceId, filter.traceId) : undefined,
    keywordCondition(filter.reasonKeyword, [workflowJobs.lastError], 'ilike'),
    filter.olderThanMinutes != null && filter.olderThanMinutes > 0
      ? lte(workflowJobs.createdAt, new Date(Date.now() - filter.olderThanMinutes * 60_000))
      : undefined,
  );
}

/** 条件重放预览：仅统计匹配的死信/失败作业数量，不执行，供前端展示"将重放约 N 条"。 */
export async function previewReplayJobs(filter: WorkflowJobReplayFilter): Promise<{ matched: number }> {
  const matched = await db.$count(workflowJobs, replayJobsWhere(filter));
  return { matched };
}

export interface WorkflowJobReplayResult extends WorkflowJobBatchResult {
  /** 条件匹配到的总数（可能超过本次上限 limit） */
  matched: number;
  /** 实际生效的错峰速率（条/秒） */
  ratePerSecond: number;
  /** 本次重放上限 */
  limit: number;
}

/**
 * 死信中心：按条件 + 限流重放死信/失败作业。
 * 通过 {@link throttledRetry} 错峰入队，并以 limit 限制单次重放规模，避免瞬时压垮连接器/DB。
 */
export async function replayDeadJobs(
  opts?: WorkflowJobReplayFilter & { ratePerSecond?: number; limit?: number },
): Promise<WorkflowJobReplayResult> {
  const rate = clampRate(opts?.ratePerSecond);
  const limit = clampLimit(opts?.limit);
  const where = replayJobsWhere(opts ?? {});
  const [matched, rows] = await Promise.all([
    db.$count(workflowJobs, where),
    db.select({ id: workflowJobs.id }).from(workflowJobs).where(where).orderBy(asc(workflowJobs.id)).limit(limit),
  ]);
  const success = await throttledRetry(rows.map((r) => r.id), rate);
  return { total: rows.length, success, skipped: rows.length - success, matched, ratePerSecond: rate, limit };
}

export type JobClusterDimension = 'reason' | 'jobType' | 'instance' | 'trace';

/** 每簇随响应携带的成员作业明细上限（按最近失败时间倒序取前 N 条） */
export const CLUSTER_MEMBER_LIMIT = 10;

/** 聚类簇内的成员作业明细：回答「哪个作业 / 哪个流程实例 / 哪个进程 / 何时失败 / 完整原因」 */
export interface JobFailureClusterMember {
  id: number;
  jobType: string;
  status: string;
  instanceId: number | null;
  instanceTitle: string | null;
  definitionName: string | null;
  nodeKey: string | null;
  attempts: number;
  maxAttempts: number;
  /** 最后领取该作业的 worker 节点（hostname:pid），失败后保留 */
  lockedBy: string | null;
  traceId: string | null;
  /** 完整原始错误（未归一） */
  lastError: string | null;
  /** 最近一次失败时间（最后一次尝试写入 lastError 的时刻） */
  failedAt: string;
  createdAt: string;
}

export interface JobFailureCluster {
  /** 聚类维度 */
  dimension: JobClusterDimension;
  /** 归一后的聚类键（reason 归一前缀 / jobType / 实例 id / traceId） */
  key: string;
  /** 展示用标签 */
  label: string;
  count: number;
  jobTypes: string[];
  /** instance 维度下的实例 id，供"重放该簇" */
  instanceId: number | null;
  /** trace 维度下的 traceId，供"重放该簇" */
  traceId: string | null;
  /** reason 维度下的错误关键字，供"重放该簇"（模糊匹配） */
  reasonKeyword: string | null;
  /** 簇内最早失败时间 */
  firstAt: string | null;
  /** 簇内最近失败时间 */
  lastAt: string | null;
  /** 涉及的流程实例数 */
  instanceCount: number;
  /** 成员作业明细（最多 CLUSTER_MEMBER_LIMIT 条，按最近失败倒序） */
  jobs: JobFailureClusterMember[];
}

/** 从原始 lastError 提取一个可用于 ilike 的字面关键字（取首个数字前的字面前缀，不足则回退取前 40 字符）。 */
export function reasonKeywordOf(lastError: string | null): string | null {
  const raw = (lastError ?? '').trim();
  if (!raw) return null;
  const lead = raw.split(/\d/)[0]!.trim();
  const kw = (lead.length >= 4 ? lead : raw).slice(0, 40).trim();
  return kw.length >= 2 ? kw : null;
}

export interface ClusterInputRow {
  id: number;
  jobType: string;
  status: string;
  lastError: string | null;
  instanceId: number | null;
  instanceTitle: string | null;
  definitionName: string | null;
  nodeKey: string | null;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  traceId: string | null;
  /** 最近失败时间（updatedAt：失败收口时写入 lastError 的时刻） */
  failedAt: Date;
  createdAt: Date;
}

/** 纯聚合逻辑：按维度对 dead/failed 行分组（无 DB 依赖，便于单测）。入参需按 failedAt 倒序，成员取每簇前 N 条即最近失败。 */
export function clusterFailureRows(rows: ClusterInputRow[], dimension: JobClusterDimension): JobFailureCluster[] {
  type Acc = JobFailureCluster & { _types: Set<string>; _instances: Set<number>; _first: number; _last: number };
  const map = new Map<string, Acc>();
  const bump = (key: string, base: Pick<JobFailureCluster, 'dimension' | 'key' | 'label' | 'instanceId' | 'traceId' | 'reasonKeyword'>, row: ClusterInputRow) => {
    let e = map.get(key);
    if (!e) {
      e = {
        ...base, count: 0, jobTypes: [], firstAt: null, lastAt: null, instanceCount: 0, jobs: [],
        _types: new Set<string>(), _instances: new Set<number>(), _first: Number.POSITIVE_INFINITY, _last: Number.NEGATIVE_INFINITY,
      };
      map.set(key, e);
    }
    e.count += 1;
    e._types.add(row.jobType);
    if (row.instanceId != null) e._instances.add(row.instanceId);
    const at = row.failedAt.getTime();
    if (at < e._first) e._first = at;
    if (at > e._last) e._last = at;
    if (e.jobs.length < CLUSTER_MEMBER_LIMIT) {
      e.jobs.push({
        id: row.id,
        jobType: row.jobType,
        status: row.status,
        instanceId: row.instanceId,
        instanceTitle: row.instanceTitle,
        definitionName: row.definitionName,
        nodeKey: row.nodeKey,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        lockedBy: row.lockedBy,
        traceId: row.traceId,
        lastError: row.lastError,
        failedAt: formatDateTime(row.failedAt),
        createdAt: formatDateTime(row.createdAt),
      });
    }
  };

  for (const r of rows) {
    if (dimension === 'jobType') {
      bump(r.jobType, { dimension, key: r.jobType, label: r.jobType, instanceId: null, traceId: null, reasonKeyword: null }, r);
    } else if (dimension === 'instance') {
      if (r.instanceId == null) continue;
      const key = String(r.instanceId);
      bump(key, { dimension, key, label: r.instanceTitle ? `${r.instanceTitle} (#${r.instanceId})` : `实例 #${r.instanceId}`, instanceId: r.instanceId, traceId: null, reasonKeyword: null }, r);
    } else if (dimension === 'trace') {
      if (!r.traceId) continue;
      bump(r.traceId, { dimension, key: r.traceId, label: r.traceId, instanceId: null, traceId: r.traceId, reasonKeyword: null }, r);
    } else {
      const reason = (r.lastError ?? '未知错误').replace(/\d+/g, 'N').slice(0, 60);
      bump(reason, { dimension, key: reason, label: reason, instanceId: null, traceId: null, reasonKeyword: reasonKeywordOf(r.lastError) }, r);
    }
  }

  return [...map.values()]
    .map(({ _types, _instances, _first, _last, ...c }) => ({
      ...c,
      jobTypes: [..._types],
      instanceCount: _instances.size,
      firstAt: Number.isFinite(_first) ? formatDateTime(new Date(_first)) : null,
      lastAt: Number.isFinite(_last) ? formatDateTime(new Date(_last)) : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/**
 * 失败原因聚类（多维）：dead/failed 作业按指定维度聚合，便于定位高频故障并直接对某簇重放。
 * - reason：按 lastError 归一前缀（数字→N，截断 60 字）
 * - jobType：按作业类型
 * - instance：按流程实例
 * - trace：按 traceId
 * 每簇附带首次/最近失败时间、涉及实例数与成员作业明细（哪个作业、哪个进程、完整错误）。
 */
export async function getJobFailureClusters(dimension: JobClusterDimension = 'reason'): Promise<JobFailureCluster[]> {
  const rows = await db
    .select({
      id: workflowJobs.id,
      jobType: workflowJobs.jobType,
      status: workflowJobs.status,
      lastError: workflowJobs.lastError,
      instanceId: workflowJobs.instanceId,
      instanceTitle: workflowInstances.title,
      definitionName: workflowDefinitions.name,
      nodeKey: workflowJobs.nodeKey,
      attempts: workflowJobs.attempts,
      maxAttempts: workflowJobs.maxAttempts,
      lockedBy: workflowJobs.lockedBy,
      traceId: workflowJobs.traceId,
      failedAt: workflowJobs.updatedAt,
      createdAt: workflowJobs.createdAt,
    })
    .from(workflowJobs)
    .leftJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .where(inArray(workflowJobs.status, ['dead', 'failed']))
    .orderBy(desc(workflowJobs.updatedAt))
    .limit(2000);

  return clusterFailureRows(rows, dimension);
}

/** 心跳新鲜阈值（与 system-scheduler.service.ts mapNode 的 90s 一致） */
const HEARTBEAT_FRESH_MS = 90_000;
/**
 * 运行状态栏节点可见窗口：只统计近 10 分钟内有心跳的节点。
 * nodeId=hostname:pid，进程每次重启都会注册新行——窗口过宽会让分母持续膨胀
 * （看起来像大量 Worker 宕机）；10 分钟窗口既能暴露「刚失联」的节点，又不累积历史行。
 */
const WORKER_VISIBLE_WINDOW_MS = 10 * 60_000;

export interface WorkflowJobRuntimeStatus {
  activeWorkers: number;
  totalWorkers: number;
  workers: Array<{ nodeId: string; hostname: string | null; runningJobCount: number; lastHeartbeatAt: string | null; fresh: boolean }>;
  runningJobs: number;
  stuckRunningJobs: number;
  backlog: number;
  deadLetter: number;
  lastClaimedAt: string | null;
  failureRate: number;
  avgDurationMs: number | null;
  recentExecutions: number;
}

/**
 * 作业平台运行状态：复用 system_scheduler_nodes 心跳 + workflow_jobs/executions 派生指标。
 * 单 Worker + drain 模型下 activeWorkers 实为"心跳新鲜的调度节点数"；
 * totalWorkers 只统计近 10 分钟有心跳的节点（历史重启行不计入分母）。
 */
export async function getWorkflowJobRuntimeStatus(): Promise<WorkflowJobRuntimeStatus> {
  const now = Date.now();
  const execCutoff = new Date(now - 60 * 60_000);

  const [
    nodes,
    runningJobs,
    stuckRunningJobs,
    backlog,
    deadLetter,
    lastClaimedRow,
    recentExecutions,
    recentFailed,
    durationRow,
  ] = await Promise.all([
    db.select({ nodeId: systemSchedulerNodes.nodeId, hostname: systemSchedulerNodes.hostname, runningJobCount: systemSchedulerNodes.runningJobCount, lastHeartbeatAt: systemSchedulerNodes.lastHeartbeatAt, active: systemSchedulerNodes.active })
      .from(systemSchedulerNodes)
      .where(gte(systemSchedulerNodes.lastHeartbeatAt, new Date(now - WORKER_VISIBLE_WINDOW_MS)))
      .orderBy(desc(systemSchedulerNodes.lastHeartbeatAt)),
    db.$count(workflowJobs, eq(workflowJobs.status, 'running')),
    db.$count(workflowJobs, expiredWorkflowJobCondition()),
    db.$count(workflowJobs, and(eq(workflowJobs.status, 'pending'), lte(workflowJobs.runAt, new Date(now)))),
    db.$count(workflowJobs, eq(workflowJobs.status, 'dead')),
    db.select({ v: max(workflowJobs.lockedAt) }).from(workflowJobs),
    db.$count(workflowJobExecutions, gte(workflowJobExecutions.createdAt, execCutoff)),
    db.$count(workflowJobExecutions, and(gte(workflowJobExecutions.createdAt, execCutoff), eq(workflowJobExecutions.status, 'failed'))),
    db.select({ v: avg(workflowJobExecutions.durationMs) }).from(workflowJobExecutions)
      .where(and(gte(workflowJobExecutions.createdAt, execCutoff), isNotNull(workflowJobExecutions.durationMs))),
  ]);

  const workers = nodes.map((n) => {
    const fresh = n.active && now - n.lastHeartbeatAt.getTime() <= HEARTBEAT_FRESH_MS;
    return { nodeId: n.nodeId, hostname: n.hostname, runningJobCount: n.runningJobCount, lastHeartbeatAt: formatNullableDateTime(n.lastHeartbeatAt), fresh };
  });
  const avgRaw = durationRow[0]?.v;

  return {
    activeWorkers: workers.filter((w) => w.fresh).length,
    totalWorkers: nodes.length,
    workers,
    runningJobs,
    stuckRunningJobs,
    backlog,
    deadLetter,
    lastClaimedAt: formatNullableDateTime(lastClaimedRow[0]?.v ?? null),
    failureRate: percentOf(recentFailed, recentExecutions) ?? 0,
    avgDurationMs: avgRaw != null ? Math.round(Number(avgRaw)) : null,
    recentExecutions,
  };
}

export interface WorkflowJobAlertMetrics {
  /** 死信作业数 */
  workflowDeadLetter: number;
  /** 近 60 分钟执行失败率（%） */
  workflowFailureRate: number;
  /** 租约失效或超过执行截止时间的 running 作业数 */
  workflowStuckRunning: number;
}

/** 供监控告警评估器采集的作业平台派生指标（死信数 / 失败率 / 卡死数），实时轻量查询。 */
export async function getWorkflowJobAlertMetrics(): Promise<WorkflowJobAlertMetrics> {
  const now = Date.now();
  const execCutoff = new Date(now - 60 * 60_000);
  const [deadLetter, stuckRunning, recentTotal, recentFailed] = await Promise.all([
    db.$count(workflowJobs, eq(workflowJobs.status, 'dead')),
    db.$count(workflowJobs, expiredWorkflowJobCondition()),
    db.$count(workflowJobExecutions, gte(workflowJobExecutions.createdAt, execCutoff)),
    db.$count(workflowJobExecutions, and(gte(workflowJobExecutions.createdAt, execCutoff), eq(workflowJobExecutions.status, 'failed'))),
  ]);
  return {
    workflowDeadLetter: deadLetter,
    workflowFailureRate: percentOf(recentFailed, recentTotal) ?? 0,
    workflowStuckRunning: stuckRunning,
  };
}
