/**
 * 触发器节点订阅者
 *
 * 监听 node.entered，当节点类型为 trigger 时执行配置的动作。trigger 任务自身维护
 * triggerDispatchStatus，避免 outbox 重放或恢复任务重复执行同一个副作用。
 */
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { workflowInstances, workflowTasks } from '../../db/schema';
import { workflowEventBus } from '../workflow-event-bus';
import { insertTriggerExecution } from '../../services/workflow-trigger-executions.service';
import { approveTaskCore, handleNodeExecutionError } from '../../services/workflow-instances.service';
import { httpRequest } from '../http-client';
import logger from '../logger';
import type {
  WorkflowFlowData,
  WorkflowTriggerNodeConfig,
  WorkflowTriggerType,
} from '@zenith/shared';

const TIMEOUT_MS_DEFAULT = 10_000;
const CLAIMABLE_DISPATCH_STATUSES = ['pending', 'retrying'] as const;
const ACTIVE_TASK_STATUSES = ['waiting', 'approved'] as const;

type TriggerTaskRow = typeof workflowTasks.$inferSelect;
type TriggerExecutionInsert = Parameters<typeof insertTriggerExecution>[0];
type TriggerRunResult = {
  status: 'success' | 'failed';
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  durationMs: number;
  requestUrl: string;
  requestMethod: string;
  requestBody: string | null;
};

function renderTemplate(
  template: string,
  formData: Record<string, unknown>,
  extras: Record<string, string> = {},
): string {
  return template
    .replace(/\{\{form\.([^}]+)\}\}/g, (_, key) => {
      const v = formData[key.trim()];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return '';
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
      return '';
    })
    .replace(/\{\{([a-zA-Z_]\w*)\}\}/g, (_, key) => extras[key] ?? '');
}

function isDataMutationTrigger(triggerType: WorkflowTriggerType): boolean {
  return triggerType === 'updateData' || triggerType === 'deleteData';
}

function resolveMaxAttempts(cfg: WorkflowTriggerNodeConfig): number {
  const onFailure = cfg.onFailure ?? 'continue';
  if (onFailure === 'continue') return 1;
  return Math.min(11, Math.max(1, (cfg.maxRetries ?? 0) + 1));
}

function computeNextRetryAt(attempt: number): Date {
  const delayMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));
  return new Date(Date.now() + delayMs);
}

function dispatchClaimCondition() {
  return or(
    isNull(workflowTasks.triggerDispatchStatus),
    inArray(workflowTasks.triggerDispatchStatus, CLAIMABLE_DISPATCH_STATUSES),
  )!;
}

function pendingDispatchCondition() {
  return or(
    isNull(workflowTasks.triggerDispatchStatus),
    eq(workflowTasks.triggerDispatchStatus, 'pending' as const),
  )!;
}

async function executeHttpTrigger(
  cfg: WorkflowTriggerNodeConfig,
  formData: Record<string, unknown>,
  extras: Record<string, string> = {},
): Promise<TriggerRunResult> {
  const url = cfg.webhookUrl ?? '';
  const method = (cfg.httpMethod ?? 'POST').toUpperCase() as 'GET' | 'POST' | 'PUT';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extras.idempotencyKey ? { 'X-Idempotency-Key': extras.idempotencyKey } : {}),
    ...(extras.instanceId ? { 'X-Workflow-Instance-Id': extras.instanceId } : {}),
    ...(extras.taskId ? { 'X-Workflow-Task-Id': extras.taskId } : {}),
    ...(extras.nodeKey ? { 'X-Workflow-Node-Key': extras.nodeKey } : {}),
    ...cfg.headers,
  };
  const bodyStr = method === 'GET' || !cfg.bodyTemplate ? null : renderTemplate(cfg.bodyTemplate, formData, extras);
  const t0 = Date.now();

  if (!url) {
    return { status: 'failed', responseStatus: null, responseBody: null, errorMessage: '未配置 webhookUrl', durationMs: 0, requestUrl: '', requestMethod: method, requestBody: bodyStr };
  }

  try {
    const resp = await httpRequest(url, { method, headers, body: bodyStr ?? undefined, timeout: cfg.timeoutMs ?? TIMEOUT_MS_DEFAULT });
    const durationMs = Date.now() - t0;
    const respText = await resp.text().catch(() => '');
    return {
      status: resp.ok ? 'success' : 'failed',
      responseStatus: resp.status,
      responseBody: respText.slice(0, 4096),
      errorMessage: resp.ok ? null : `HTTP ${resp.status}`,
      durationMs,
      requestUrl: url,
      requestMethod: method,
      requestBody: bodyStr,
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', responseStatus: null, responseBody: null, errorMessage: msg.slice(0, 1024), durationMs, requestUrl: url, requestMethod: method, requestBody: bodyStr };
  }
}

async function executeDataMutation(
  cfg: WorkflowTriggerNodeConfig,
  instanceId: number,
  formData: Record<string, unknown>,
): Promise<Pick<TriggerRunResult, 'status' | 'responseBody' | 'errorMessage' | 'durationMs' | 'requestBody'>> {
  const t0 = Date.now();
  const fieldKeys = cfg.fieldKeys ?? [];
  const requestBody = JSON.stringify({ fieldKeys, fieldValues: cfg.fieldValues ?? null });
  try {
    const next = await db.transaction(async (tx) => {
      const [locked] = await tx.select({ formData: workflowInstances.formData })
        .from(workflowInstances)
        .where(eq(workflowInstances.id, instanceId))
        .for('update')
        .limit(1);
      const base = (locked?.formData ?? formData ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...base };
      if (cfg.triggerType === 'updateData') {
        const values = cfg.fieldValues ?? {};
        for (const key of fieldKeys) {
          const template = values[key];
          merged[key] = template === undefined ? null : renderTemplate(template, base);
        }
      } else if (cfg.triggerType === 'deleteData') {
        for (const key of fieldKeys) delete merged[key];
      }
      await tx.update(workflowInstances).set({ formData: merged }).where(eq(workflowInstances.id, instanceId));
      return merged;
    });
    return {
      status: 'success',
      responseBody: JSON.stringify(next).slice(0, 4096),
      errorMessage: null,
      durationMs: Date.now() - t0,
      requestBody,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      responseBody: null,
      errorMessage: msg.slice(0, 1024),
      durationMs: Date.now() - t0,
      requestBody,
    };
  }
}

async function claimTriggerTask(instanceId: number, nodeKey: string, taskId?: number): Promise<TriggerTaskRow | null> {
  const conditions = [
    eq(workflowTasks.instanceId, instanceId),
    eq(workflowTasks.nodeKey, nodeKey),
    eq(workflowTasks.nodeType, 'trigger' as const),
    inArray(workflowTasks.status, ACTIVE_TASK_STATUSES),
    dispatchClaimCondition(),
  ];
  if (taskId != null) conditions.push(eq(workflowTasks.id, taskId));

  const [candidate] = await db.select().from(workflowTasks)
    .where(and(...conditions))
    .orderBy(desc(workflowTasks.id))
    .limit(1);
  if (!candidate) return null;

  const [claimed] = await db.update(workflowTasks).set({
    triggerDispatchStatus: 'running' as const,
    triggerAttempt: sql`${workflowTasks.triggerAttempt} + 1`,
    triggerStartedAt: new Date(),
    triggerNextRetryAt: null,
    triggerLastError: null,
  }).where(and(
    eq(workflowTasks.id, candidate.id),
    inArray(workflowTasks.status, ACTIVE_TASK_STATUSES),
    dispatchClaimCondition(),
  )).returning();
  return claimed ?? null;
}

async function markTriggerSuccess(taskId: number): Promise<void> {
  await db.update(workflowTasks).set({
    triggerDispatchStatus: 'success' as const,
    triggerStartedAt: null,
    triggerNextRetryAt: null,
    triggerLastError: null,
  }).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.triggerDispatchStatus, 'running' as const)));
}

async function markTriggerRetrying(taskId: number, nextRetryAt: Date, errorMessage: string): Promise<void> {
  await db.update(workflowTasks).set({
    triggerDispatchStatus: 'retrying' as const,
    triggerStartedAt: null,
    triggerNextRetryAt: nextRetryAt,
    triggerLastError: errorMessage.slice(0, 2048),
  }).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.triggerDispatchStatus, 'running' as const)));
}

async function markTriggerFailed(taskId: number, errorMessage: string): Promise<void> {
  await db.update(workflowTasks).set({
    triggerDispatchStatus: 'failed' as const,
    triggerStartedAt: null,
    triggerNextRetryAt: null,
    triggerLastError: errorMessage.slice(0, 2048),
  }).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.triggerDispatchStatus, 'running' as const)));
}

async function insertExecutionBestEffort(input: TriggerExecutionInsert): Promise<void> {
  try {
    await insertTriggerExecution(input);
  } catch (err) {
    logger.error('[trigger-subscriber] insert execution record failed', { instanceId: input.instanceId, taskId: input.taskId, nodeKey: input.nodeKey, err });
  }
}

async function runTrigger(
  cfg: WorkflowTriggerNodeConfig,
  triggerType: WorkflowTriggerType,
  task: TriggerTaskRow,
  inst: typeof workflowInstances.$inferSelect,
): Promise<TriggerRunResult> {
  const formData = (inst.formData ?? {}) as Record<string, unknown>;
  if (triggerType === 'webhook' || triggerType === 'callback') {
    const extras: Record<string, string> = {
      idempotencyKey: `workflow-trigger:${task.id}:${task.triggerAttempt}`,
      instanceId: String(inst.id),
      taskId: String(task.id),
      nodeKey: task.nodeKey,
    };
    if (triggerType === 'callback' && task.externalCallbackId) {
      const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
      extras.callbackUrl = `${base}/api/public/workflow/trigger-callback/${task.externalCallbackId}`;
      extras.callbackId = task.externalCallbackId;
    }
    return executeHttpTrigger(cfg, formData, extras);
  }
  if (triggerType === 'updateData' || triggerType === 'deleteData') {
    const result = await executeDataMutation(cfg, inst.id, formData);
    return {
      status: result.status,
      responseStatus: null,
      responseBody: result.responseBody,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
      requestUrl: '',
      requestMethod: triggerType,
      requestBody: result.requestBody,
    };
  }
  return { status: 'failed', responseStatus: null, responseBody: null, errorMessage: `未知触发器类型 ${triggerType as string}`, durationMs: 0, requestUrl: '', requestMethod: '', requestBody: null };
}

export async function dispatchTrigger(instanceId: number, nodeKey: string, nodeName: string, taskId?: number): Promise<boolean> {
  const task = await claimTriggerTask(instanceId, nodeKey, taskId);
  if (!task) return false;

  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId)).limit(1);
  if (!inst) {
    await markTriggerFailed(task.id, '流程实例不存在');
    return false;
  }
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  const node = flowData?.nodes.find((n) => n.data.key === nodeKey);
  const cfg = node?.data.triggerConfig;
  if (!cfg) {
    await markTriggerFailed(task.id, '触发器节点缺少 triggerConfig');
    logger.warn('[trigger-subscriber] 触发器节点缺少 triggerConfig', { instanceId, nodeKey });
    return false;
  }

  const triggerType: WorkflowTriggerType = cfg.triggerType;
  const result = await runTrigger(cfg, triggerType, task, inst);
  const attempt = task.triggerAttempt;
  const errorMessage = result.errorMessage ?? '触发器执行失败';

  if (result.status === 'success') {
    await markTriggerSuccess(task.id);
    await insertExecutionBestEffort({
      instanceId,
      taskId: task.id,
      nodeKey,
      nodeName,
      triggerType,
      status: 'success',
      attempt,
      requestUrl: result.requestUrl || null,
      requestMethod: result.requestMethod || null,
      requestBody: result.requestBody,
      responseStatus: result.responseStatus,
      responseBody: result.responseBody,
      errorMessage: null,
      durationMs: result.durationMs,
      tenantId: inst.tenantId ?? null,
    });

    const shouldAdvance = task.status === 'waiting' && triggerType !== 'callback' && ((cfg.onFailure ?? 'continue') === 'block' || isDataMutationTrigger(triggerType));
    if (shouldAdvance) {
      await approveTaskCore(task, inst, '触发器执行成功，自动推进', { userId: 0, name: 'trigger:block' });
    }
    return true;
  }

  const maxAttempts = resolveMaxAttempts(cfg);
  const shouldRetry = attempt < maxAttempts;
  if (shouldRetry) {
    await markTriggerRetrying(task.id, computeNextRetryAt(attempt), errorMessage);
  } else {
    await markTriggerFailed(task.id, errorMessage);
  }
  await insertExecutionBestEffort({
    instanceId,
    taskId: task.id,
    nodeKey,
    nodeName,
    triggerType,
    status: shouldRetry ? 'retrying' : 'failed',
    attempt,
    requestUrl: result.requestUrl || null,
    requestMethod: result.requestMethod || null,
    requestBody: result.requestBody,
    responseStatus: result.responseStatus,
    responseBody: result.responseBody,
    errorMessage,
    durationMs: result.durationMs,
    tenantId: inst.tenantId ?? null,
  });

  if (shouldRetry) return true;
  if (task.status === 'waiting') {
    const handled = await handleNodeExecutionError({
      instance: inst,
      task,
      nodeKey,
      nodeName,
      errorMessage,
      actor: { userId: 0, name: 'trigger' },
    });
    if (handled) return true;
    logger.warn('[trigger-subscriber] 阻塞触发器执行失败，流程已阻塞，等待人工处理', { instanceId, nodeKey, attempt, error: errorMessage });
  }
  return true;
}

export async function recoverPendingWorkflowTriggers(graceMinutes = 5, limit = 100): Promise<{ scanned: number; dispatched: number; skipped: number }> {
  const cutoff = new Date(Date.now() - graceMinutes * 60_000);
  const now = new Date();

  await db.update(workflowTasks).set({
    triggerDispatchStatus: 'retrying' as const,
    triggerStartedAt: null,
    triggerNextRetryAt: now,
    triggerLastError: '触发器调度中断，等待恢复重试',
  }).where(and(
    eq(workflowTasks.nodeType, 'trigger' as const),
    inArray(workflowTasks.status, ACTIVE_TASK_STATUSES),
    eq(workflowTasks.triggerDispatchStatus, 'running' as const),
    or(
      lte(workflowTasks.triggerStartedAt, cutoff),
      and(isNull(workflowTasks.triggerStartedAt), lte(workflowTasks.createdAt, cutoff)),
    ),
  ));

  const rows = await db.select({
    id: workflowTasks.id,
    instanceId: workflowTasks.instanceId,
    nodeKey: workflowTasks.nodeKey,
    nodeName: workflowTasks.nodeName,
  }).from(workflowTasks)
    .where(and(
      eq(workflowTasks.nodeType, 'trigger' as const),
      inArray(workflowTasks.status, ACTIVE_TASK_STATUSES),
      or(
        and(pendingDispatchCondition(), lte(workflowTasks.createdAt, cutoff)),
        and(eq(workflowTasks.triggerDispatchStatus, 'retrying' as const), or(isNull(workflowTasks.triggerNextRetryAt), lte(workflowTasks.triggerNextRetryAt, now))),
      ),
    ))
    .orderBy(asc(workflowTasks.createdAt))
    .limit(Math.max(1, Math.min(limit, 500)));

  let dispatched = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const ok = await dispatchTrigger(row.instanceId, row.nodeKey, row.nodeName, row.id);
      if (ok) dispatched += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      logger.error('[trigger-subscriber] recovery dispatch failed', { taskId: row.id, instanceId: row.instanceId, nodeKey: row.nodeKey, err });
    }
  }
  return { scanned: rows.length, dispatched, skipped };
}

export function registerTriggerWorkflowSubscriber(): void {
  workflowEventBus.on('node.entered', (event) => {
    if (event.nodeType !== 'trigger') return;
    void dispatchTrigger(event.instanceId, event.nodeKey, event.nodeName).catch((err) => {
      logger.error('[trigger-subscriber] dispatch failed', { instanceId: event.instanceId, nodeKey: event.nodeKey, err });
    });
  });
}
