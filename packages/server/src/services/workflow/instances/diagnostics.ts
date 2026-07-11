// ─── 运行时诊断、执行轨迹与引擎解释（拆分自 workflow-instances.service.ts）───
import { formatDateTime, formatNullableDateTime } from '../../../lib/datetime';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowJobs, workflowJobExecutions, workflowInstances, workflowTasks, workflowTokens, users } from '../../../db/schema';
import { tenantCondition } from '../../../lib/tenant';
import { getDataScopeCondition } from '../../../lib/data-scope';
import type { WorkflowDefinitionSnapshot, WorkflowInstance, WorkflowRuntimeDiagnostics, WorkflowRuntimeIssue, WorkflowRuntimeOutboxEvent, WorkflowTriggerType, WorkflowInstanceTrace, WorkflowEngineExplanation, WorkflowEngineExplanationBlocker, WorkflowEngineTraceEntry, WorkflowJobType, WorkflowExecutionToken, WorkflowExecutionTokenView } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { mapInstance, mapTask } from './mapping';

function mapRuntimeOutboxEvent(row: typeof workflowJobs.$inferSelect): WorkflowRuntimeOutboxEvent {
  const event = (row.payload as { event?: { eventId?: string; type?: string } } | null)?.event;
  return {
    id: row.id,
    eventId: event?.eventId ?? row.idempotencyKey ?? String(row.id),
    eventType: event?.type ?? 'event_dispatch',
    taskId: row.taskId ?? null,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.lastError ?? null,
    nextRetryAt: row.status === 'pending' ? formatNullableDateTime(row.runAt) : null,
    processedAt: row.status === 'succeeded' ? formatNullableDateTime(row.updatedAt) : null,
    createdAt: formatDateTime(row.createdAt),
  };
}

// TODO(workflow-jobs P5): job_executions 未存 nodeName/triggerType，nodeKey/instanceId 取自父 job
function mapRuntimeTriggerExecution(row: { exec: typeof workflowJobExecutions.$inferSelect; job: typeof workflowJobs.$inferSelect }) {
  const { exec, job } = row;
  const status: 'running' | 'success' | 'failed' =
    exec.status === 'succeeded' ? 'success' : exec.status === 'failed' ? 'failed' : 'running';
  return {
    id: exec.id,
    instanceId: job.instanceId ?? 0,
    taskId: job.taskId ?? null,
    nodeKey: job.nodeKey ?? '',
    nodeName: null as string | null,
    triggerType: 'webhook' as WorkflowTriggerType,
    status,
    attempt: exec.attempt,
    requestUrl: exec.requestUrl ?? null,
    requestMethod: exec.requestMethod ?? null,
    requestBody: exec.requestBody ?? null,
    responseStatus: exec.responseStatus ?? null,
    responseBody: exec.responseBody ?? null,
    errorMessage: exec.errorMessage ?? null,
    durationMs: exec.durationMs ?? null,
    tenantId: exec.tenantId ?? null,
    createdAt: formatDateTime(exec.createdAt),
  };
}

function buildRuntimeIssues(input: {
  inst: typeof workflowInstances.$inferSelect;
  tasks: ReturnType<typeof mapTask>[];
  triggerExecutions: ReturnType<typeof mapRuntimeTriggerExecution>[];
  outboxEvents: WorkflowRuntimeOutboxEvent[];
  jobs: typeof workflowJobs.$inferSelect[];
  tokens: WorkflowExecutionToken[];
}): WorkflowRuntimeIssue[] {
  const issues: WorkflowRuntimeIssue[] = [];
  const activeTasks = input.tasks.filter((task) => task.status === 'pending' || task.status === 'waiting');
  if (input.inst.status === 'running' && activeTasks.length === 0) {
    issues.push({
      severity: 'critical',
      source: 'instance',
      title: '运行中实例没有活动任务',
      description: '实例状态仍为 running，但没有 pending/waiting 任务，可能存在推进中断或状态未回写。',
    });
  }
  // 外部审批 / 触发器作业失败（workflow_jobs）
  for (const job of input.jobs) {
    if (job.status !== 'failed' && job.status !== 'dead') continue;
    if (job.jobType === 'external_dispatch') {
      issues.push({
        severity: 'critical',
        source: 'task',
        taskId: job.taskId ?? undefined,
        nodeKey: job.nodeKey ?? undefined,
        title: '外部审批分派失败',
        description: job.lastError ?? '外部审批作业失败，需要检查外部审批配置或人工介入。',
      });
    } else if (job.jobType === 'trigger_dispatch') {
      issues.push({
        severity: 'critical',
        source: 'trigger',
        taskId: job.taskId ?? undefined,
        nodeKey: job.nodeKey ?? undefined,
        title: '触发器执行失败',
        description: job.lastError ?? '触发器作业已失败，流程仍在等待该节点。',
      });
    }
  }
  for (const task of input.tasks) {
    if (task.status !== 'pending' && task.status !== 'waiting') continue;
    if (task.nodeType === 'trigger' && task.status === 'waiting' && !input.triggerExecutions.some((item) => item.taskId === task.id)) {
      issues.push({
        severity: 'warning',
        source: 'trigger',
        taskId: task.id,
        nodeKey: task.nodeKey,
        title: '触发器暂无执行记录',
        description: '等待中的 trigger 任务未发现执行记录，可关注事件派发是否重放失败或 dispatch 状态是否仍为 pending。',
      });
    }
  }
  for (const event of input.outboxEvents) {
    if (event.status === 'failed') {
      issues.push({
        severity: 'critical',
        source: 'outbox',
        taskId: event.taskId,
        title: '事件派发失败',
        description: event.errorMessage ?? `事件 ${event.eventType} 已失败，请检查订阅者或事件处理日志。`,
      });
    } else if (event.status === 'pending' || event.status === 'retrying') {
      issues.push({
        severity: 'warning',
        source: 'outbox',
        taskId: event.taskId,
        title: '事件派发待处理',
        description: `事件 ${event.eventType} 当前为 ${event.status}，attempts=${event.attempts}。`,
      });
    }
  }
  // Token 一致性诊断（显式执行 Token 模型）
  const activeTokens = input.tokens.filter((t) => t.status === 'active');
  if (input.inst.status === 'running' && activeTokens.length === 0) {
    issues.push({
      severity: 'critical',
      source: 'token',
      title: '运行中实例无活动执行 Token',
      description: 'running 实例没有任何 active token，执行路径可能中断（旧实例未接入 token 模型或推进异常）。',
    });
  }
  const tokenFrontierTaskKeys = new Set(activeTasks.map((t) => t.nodeKey));
  for (const tk of activeTokens) {
    if (tk.parkedAtJoin) continue; // parked join token 无对应任务，属正常等待
    if (!tokenFrontierTaskKeys.has(tk.nodeKey)) {
      issues.push({
        severity: 'warning',
        source: 'token',
        nodeKey: tk.nodeKey,
        title: 'Token 与任务不一致',
        description: `节点「${tk.nodeName ?? tk.nodeKey}」存在 active token 但无 pending/waiting 任务，可能状态漂移。`,
      });
    }
  }
  if (issues.length === 0) {
    issues.push({
      severity: 'info',
      source: 'instance',
      title: '未发现明显运行时异常',
      description: '任务状态、触发器执行、事件派发与执行 Token 未命中内置诊断规则。',
    });
  }
  return issues;
}

/** 流程定义快照 → 节点元信息（名称/类型）映射 */
function buildNodeMetaFromSnapshot(snapshot: WorkflowDefinitionSnapshot | null | undefined): Map<string, { name: string | null; type: string | undefined }> {
  const map = new Map<string, { name: string | null; type: string | undefined }>();
  const flowData = snapshot?.flowData;
  if (flowData?.nodes) {
    for (const n of flowData.nodes) map.set(n.data.key, { name: n.data.label ?? null, type: n.data.type });
  }
  return map;
}

function mapExecutionToken(
  row: typeof workflowTokens.$inferSelect,
  nodeMeta: Map<string, { name: string | null; type: string | undefined }>,
): WorkflowExecutionToken {
  const meta = nodeMeta.get(row.nodeKey);
  const branchPath = (row.branchPath ?? []) as Array<{ id: string; index: number; total: number }>;
  const isJoinNode = meta?.type === 'parallelGateway' || meta?.type === 'inclusiveGateway';
  return {
    id: row.id,
    nodeKey: row.nodeKey,
    nodeName: meta?.name ?? null,
    status: row.status,
    parkedAtJoin: row.status === 'active' && isJoinNode,
    branchPath,
    depth: branchPath.length,
    parentTokenId: row.parentTokenId,
    scopeKey: row.scopeKey ?? null,
    createdAt: formatDateTime(row.createdAt),
    consumedAt: formatNullableDateTime(row.consumedAt),
  };
}

function buildTokenView(instanceId: number, tokens: WorkflowExecutionToken[]): WorkflowExecutionTokenView {
  return {
    instanceId,
    activeCount: tokens.filter((t) => t.status === 'active' && !t.parkedAtJoin).length,
    parkedCount: tokens.filter((t) => t.parkedAtJoin).length,
    consumedCount: tokens.filter((t) => t.status === 'consumed').length,
    deadCount: tokens.filter((t) => t.status === 'dead').length,
    tokens,
    generatedAt: formatDateTime(new Date()),
  };
}

/** 实例的显式执行 Token 列表（活动路径 + 血缘，用于运行态可观测/重放） */
export async function getInstanceExecutionTokens(id: number): Promise<WorkflowExecutionTokenView> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const scopeCond = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });
  if (scopeCond) conditions.push(scopeCond);
  const [inst] = await db.select({ id: workflowInstances.id, definitionSnapshot: workflowInstances.definitionSnapshot })
    .from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在或无权查看' });
  const nodeMeta = buildNodeMetaFromSnapshot(inst.definitionSnapshot);
  const rows = await db.select().from(workflowTokens).where(eq(workflowTokens.instanceId, id)).orderBy(workflowTokens.id);
  return buildTokenView(id, rows.map((r) => mapExecutionToken(r, nodeMeta)));
}

export async function getInstanceRuntimeDiagnostics(id: number): Promise<WorkflowRuntimeDiagnostics> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const scopeCond = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });
  if (scopeCond) conditions.push(scopeCond);

  const row = await db.query.workflowInstances.findFirst({
    where: and(...conditions),
    with: {
      definition: { columns: { name: true, categoryId: true }, with: { category: { columns: { name: true } } } },
      initiator: { columns: { nickname: true, avatar: true } },
      tasks: {
        with: { assignee: { columns: { nickname: true, avatar: true } } },
        orderBy: workflowTasks.id,
      },
    },
  });
  if (!row) throw new HTTPException(404, { message: '流程实例不存在或无权查看' });

  const snapshot = row.definitionSnapshot;
  const tasks = row.tasks.map((task) => {
    const cfg = snapshot?.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
    return mapTask(
      task,
      task.assignee?.nickname,
      task.assignee?.avatar,
      cfg?.actionButtons ?? null,
      cfg?.operations?.includes('signature') ?? false,
    );
  });
  const [triggerExecRows, eventJobRows, instanceJobs, tokenRows] = await Promise.all([
    db.select({ exec: workflowJobExecutions, job: workflowJobs })
      .from(workflowJobExecutions)
      .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
      .where(and(eq(workflowJobs.instanceId, id), eq(workflowJobExecutions.jobType, 'trigger_dispatch')))
      .orderBy(desc(workflowJobExecutions.id))
      .limit(50),
    db.select().from(workflowJobs)
      .where(and(eq(workflowJobs.instanceId, id), eq(workflowJobs.jobType, 'event_dispatch')))
      .orderBy(desc(workflowJobs.id))
      .limit(80),
    db.select().from(workflowJobs).where(eq(workflowJobs.instanceId, id)).limit(200),
    db.select().from(workflowTokens).where(eq(workflowTokens.instanceId, id)).orderBy(workflowTokens.id),
  ]);
  const triggerExecutions = triggerExecRows.map(mapRuntimeTriggerExecution);
  const outboxEvents = eventJobRows.map(mapRuntimeOutboxEvent);
  const nodeMeta = buildNodeMetaFromSnapshot(row.definitionSnapshot);
  const tokens = tokenRows.map((r) => mapExecutionToken(r, nodeMeta));
  const instance = mapInstance(row, {
    definitionName: row.definition?.name ?? null,
    categoryId: row.definition?.categoryId ?? null,
    categoryName: row.definition?.category?.name ?? null,
    initiatorName: row.initiator?.nickname ?? null,
    initiatorAvatar: row.initiator?.avatar ?? null,
    tasks,
    includeDefinitionSnapshot: true,
  }) as WorkflowInstance;
  const activeTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'waiting');
  return {
    instance,
    tasks,
    activeTasks,
    triggerExecutions,
    outboxEvents,
    issues: buildRuntimeIssues({ inst: row, tasks, triggerExecutions, outboxEvents, jobs: instanceJobs, tokens }),
    tokens,
    snapshot: {
      formData: (row.formData ?? null) as Record<string, unknown> | null,
      formSnapshot: row.formSnapshot ?? null,
      definitionSnapshot: row.definitionSnapshot ?? null,
    },
    generatedAt: formatDateTime(new Date()),
  };
}

const JOB_TYPE_LABELS: Record<WorkflowJobType, string> = {
  delay_wake: '延时唤醒', task_timeout: '任务超时', trigger_dispatch: '触发器调度', external_dispatch: '外部审批',
  subprocess_spawn: '子流程派生', subprocess_join: '子流程汇聚', event_dispatch: '事件派发', webhook_delivery: 'Webhook 投递',
  compensation_action: '补偿动作',
};

function humanizeMinutes(min: number): string {
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟`;
  if (min < 1440) return `${Math.floor(min / 60)} 小时`;
  return `${Math.floor(min / 1440)} 天`;
}

function nodeActionWord(nodeType: string | null): string {
  if (nodeType === 'approve') return '审批';
  if (nodeType === 'handler') return '办理';
  return '处理';
}

function jobPayloadSuffix(jobType: WorkflowJobType, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const event = p.event as Record<string, unknown> | undefined;
  if ((jobType === 'event_dispatch' || jobType === 'webhook_delivery') && typeof event?.type === 'string') return ` · ${event.type}`;
  return '';
}

function buildEngineExplanation(
  inst: { status: string },
  tasks: Array<{ id: number; nodeName: string | null; nodeType: string | null; status: string; assigneeName: string | null; createdAt: Date }>,
  jobs: Array<{ id: number; jobType: WorkflowJobType; status: string; runAt: Date; lastError: string | null; nodeName: string | null }>,
): WorkflowEngineExplanation {
  const now = Date.now();
  const activeTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'waiting');
  const failedJobs = jobs.filter((j) => j.status === 'failed' || j.status === 'dead');
  const pendingJobs = jobs.filter((j) => j.status === 'pending' || j.status === 'running');
  const blockers: WorkflowEngineExplanationBlocker[] = [];

  for (const j of failedJobs) {
    blockers.push({
      kind: 'job', severity: 'critical', jobId: j.id, taskId: null, jobType: j.jobType, nodeName: j.nodeName,
      title: `${JOB_TYPE_LABELS[j.jobType]}${j.status === 'dead' ? '已进入死信' : '执行失败'}`,
      detail: j.lastError ?? '无错误详情',
      waitingMinutes: null,
      nextRetryAt: j.status === 'failed' ? formatNullableDateTime(j.runAt) : null,
    });
  }
  for (const t of activeTasks) {
    const min = Math.max(0, Math.floor((now - t.createdAt.getTime()) / 60000));
    blockers.push({
      kind: 'task', severity: min > 1440 ? 'warning' : 'info', taskId: t.id, jobId: null, jobType: null, nodeName: t.nodeName,
      title: `等待${t.assigneeName ?? '处理人'}${nodeActionWord(t.nodeType)}`,
      detail: `节点「${t.nodeName ?? t.id}」· 已等待 ${humanizeMinutes(min)}`,
      waitingMinutes: min, nextRetryAt: null,
    });
  }
  for (const j of pendingJobs) {
    blockers.push({
      kind: 'job', severity: 'info', jobId: j.id, taskId: null, jobType: j.jobType, nodeName: j.nodeName,
      title: `${JOB_TYPE_LABELS[j.jobType]}待执行`,
      detail: `计划于 ${formatDateTime(j.runAt)} 执行`,
      waitingMinutes: null, nextRetryAt: formatNullableDateTime(j.runAt),
    });
  }

  const nextWakeAt = pendingJobs.length > 0
    ? formatDateTime(new Date(Math.min(...pendingJobs.map((j) => j.runAt.getTime()))))
    : null;
  const lastError = failedJobs.length > 0 ? (failedJobs[0].lastError ?? null) : null;

  let state: WorkflowEngineExplanation['state'];
  if (inst.status === 'approved') state = 'completed';
  else if (inst.status === 'rejected') state = 'rejected';
  else if (inst.status === 'cancelled') state = 'canceled';
  else if (inst.status === 'withdrawn') state = 'withdrawn';
  else if (inst.status === 'draft') state = 'draft';
  else state = failedJobs.length > 0 ? 'blocked' : 'running';

  let headline: string;
  switch (state) {
    case 'completed': headline = '流程已通过，全部审批完成'; break;
    case 'rejected': headline = '流程已被驳回'; break;
    case 'canceled': headline = '流程已取消'; break;
    case 'withdrawn': headline = '流程已撤回'; break;
    case 'draft': headline = '草稿尚未提交'; break;
    case 'blocked': headline = `流程推进受阻：${failedJobs.length} 个自动作业失败，需人工介入`; break;
    default:
      headline = activeTasks.length > 0
        ? blockers.find((b) => b.kind === 'task')?.title ?? '流程进行中'
        : pendingJobs.length > 0 ? `等待自动作业执行（${pendingJobs.length} 项）` : '流程进行中';
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
  blockers.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { state, headline, blockers, lastError, nextWakeAt, pendingJobCount: pendingJobs.length, failedJobCount: failedJobs.length };
}

/**
 * 运行轨迹 + 引擎解释：把任务流转（workflow_tasks）与异步作业（workflow_jobs +
 * workflow_job_executions）按时间合并，回答"为什么停这儿、在等谁、等什么、下次何时重试"。
 */
export async function getInstanceTrace(id: number): Promise<WorkflowInstanceTrace> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const scopeCond = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });
  if (scopeCond) conditions.push(scopeCond);

  const row = await db.query.workflowInstances.findFirst({
    where: and(...conditions),
    columns: { id: true, title: true, status: true, definitionSnapshot: true },
    with: {
      tasks: { with: { assignee: { columns: { nickname: true } } }, orderBy: workflowTasks.id },
    },
  });
  if (!row) throw new HTTPException(404, { message: '流程实例不存在或无权查看' });

  const jobs = await db.select().from(workflowJobs).where(eq(workflowJobs.instanceId, id)).orderBy(workflowJobs.id);
  const jobIds = jobs.map((j) => j.id);
  const execRows = jobIds.length > 0
    ? await db.select().from(workflowJobExecutions).where(inArray(workflowJobExecutions.jobId, jobIds)).orderBy(workflowJobExecutions.id)
    : [];
  const execByJob = new Map<number, typeof execRows>();
  for (const e of execRows) {
    const list = execByJob.get(e.jobId);
    if (list) list.push(e); else execByJob.set(e.jobId, [e]);
  }

  // 节点名解析映射（job 仅有 nodeKey/taskId）
  const nodeNameByTaskId = new Map<number, string | null>();
  const nodeNameByKey = new Map<string, string | null>();
  for (const t of row.tasks) {
    nodeNameByTaskId.set(t.id, t.nodeName);
    if (t.nodeKey) nodeNameByKey.set(t.nodeKey, t.nodeName);
  }
  const jobNodeName = (j: { taskId: number | null; nodeKey: string | null }): string | null => {
    if (j.taskId != null) {
      const byTask = nodeNameByTaskId.get(j.taskId);
      if (byTask != null) return byTask;
    }
    if (j.nodeKey != null) {
      const byKey = nodeNameByKey.get(j.nodeKey);
      if (byKey != null) return byKey;
    }
    return null;
  };

  const explanation = buildEngineExplanation(
    row,
    row.tasks.map((t) => ({
      id: t.id, nodeName: t.nodeName, nodeType: t.nodeType as string | null, status: t.status as string,
      assigneeName: t.assignee?.nickname ?? null, createdAt: t.createdAt,
    })),
    jobs.map((j) => ({ id: j.id, jobType: j.jobType, status: j.status as string, runAt: j.runAt, lastError: j.lastError, nodeName: jobNodeName(j) })),
  );

  // 合并时间线条目（任务流转 + 异步作业），按真实时间戳升序
  const ACTION_LABEL: Record<string, string> = { approved: '通过', rejected: '驳回', skipped: '跳过', pending: '待处理', waiting: '等待中' };
  const buf: Array<{ ts: number; entry: WorkflowEngineTraceEntry }> = [];

  for (const t of row.tasks) {
    const assigneeName = t.assignee?.nickname ?? null;
    buf.push({
      ts: t.createdAt.getTime(),
      entry: {
        key: `task-new-${t.id}`, kind: 'task', at: formatDateTime(t.createdAt), traceId: null,
        title: `创建${nodeActionWord(t.nodeType)}任务${assigneeName ? `：${assigneeName}` : ''}`,
        status: t.status, nodeName: t.nodeName, assigneeName, comment: null,
        jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
      },
    });
    if (t.actionAt) {
      buf.push({
        ts: t.actionAt.getTime(),
        entry: {
          key: `task-act-${t.id}`, kind: 'task', at: formatDateTime(t.actionAt), traceId: null,
          title: `${assigneeName ?? '处理人'} ${ACTION_LABEL[t.status] ?? t.status}`,
          status: t.status, nodeName: t.nodeName, assigneeName, comment: t.comment ?? null,
          jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
        },
      });
    }
  }

  for (const j of jobs) {
    const execs = (execByJob.get(j.id) ?? []).map((e) => ({
      attempt: e.attempt, status: e.status, requestUrl: e.requestUrl, requestMethod: e.requestMethod,
      responseStatus: e.responseStatus, durationMs: e.durationMs, errorMessage: e.errorMessage,
      finishedAt: formatNullableDateTime(e.finishedAt),
    }));
    buf.push({
      ts: j.createdAt.getTime(),
      entry: {
        key: `job-${j.id}`, kind: 'job', at: formatDateTime(j.createdAt), traceId: j.traceId,
        title: `${JOB_TYPE_LABELS[j.jobType]}${jobPayloadSuffix(j.jobType, j.payload)}`,
        status: j.status, nodeName: jobNodeName(j), assigneeName: null, comment: null,
        jobId: j.id, jobType: j.jobType, attempts: j.attempts, maxAttempts: j.maxAttempts,
        runAt: formatDateTime(j.runAt),
        nextRetryAt: (j.status === 'pending' || j.status === 'failed') ? formatNullableDateTime(j.runAt) : null,
        lastError: j.lastError, executions: execs,
      },
    });
  }

  // 显式执行 Token 生命周期（进入 / 消费·汇聚 / 终止）并入时间线
  const traceNodeMeta = buildNodeMetaFromSnapshot(row.definitionSnapshot);
  const tokenRows = await db.select().from(workflowTokens).where(eq(workflowTokens.instanceId, id)).orderBy(workflowTokens.id);
  for (const tk of tokenRows) {
    const nodeName = traceNodeMeta.get(tk.nodeKey)?.name ?? nodeNameByKey.get(tk.nodeKey) ?? tk.nodeKey;
    const bp = (tk.branchPath ?? []) as Array<{ id: string; index: number; total: number }>;
    const branchLabel = bp.length > 0 ? `分支 ${bp.map((f) => `${f.index + 1}/${f.total}`).join('·')}` : '主路径';
    buf.push({
      ts: tk.createdAt.getTime(),
      entry: {
        key: `token-new-${tk.id}`, kind: 'token', at: formatDateTime(tk.createdAt), traceId: null,
        title: `执行 Token #${tk.id} 进入「${nodeName}」`,
        status: tk.status, nodeName, assigneeName: null, comment: branchLabel,
        jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
      },
    });
    if (tk.consumedAt && (tk.status === 'consumed' || tk.status === 'dead')) {
      buf.push({
        ts: tk.consumedAt.getTime(),
        entry: {
          key: `token-end-${tk.id}`, kind: 'token', at: formatDateTime(tk.consumedAt), traceId: null,
          title: `执行 Token #${tk.id} ${tk.status === 'consumed' ? '消费（推进/汇聚）' : '终止'}：「${nodeName}」`,
          status: tk.status, nodeName, assigneeName: null, comment: branchLabel,
          jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
        },
      });
    }
  }

  buf.sort((a, b) => (a.ts - b.ts) || a.entry.key.localeCompare(b.entry.key));

  return {
    instanceId: row.id,
    title: row.title,
    explanation,
    trace: buf.map((b) => b.entry),
    generatedAt: formatDateTime(new Date()),
  };
}

/** 导出实例诊断包（诊断 + 轨迹 + 执行 Token），供离线分析 / 工单留档 */
export async function exportInstanceDiagnosticBundle(instanceId: number) {
  const [diagnostics, trace, tokens] = await Promise.all([
    getInstanceRuntimeDiagnostics(instanceId),
    getInstanceTrace(instanceId),
    getInstanceExecutionTokens(instanceId),
  ]);
  return { instanceId, generatedAt: formatDateTime(new Date()), diagnostics, trace, tokens };
}
