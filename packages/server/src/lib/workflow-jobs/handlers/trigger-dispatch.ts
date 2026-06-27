import { eq } from 'drizzle-orm';
import type { WorkflowTriggerNodeConfig, WorkflowTriggerType } from '@zenith/shared';
import { db } from '../../../db';
import { workflowTasks, workflowInstances } from '../../../db/schema';
import type { workflowTasks as workflowTasksTable, workflowInstances as workflowInstancesTable } from '../../../db/schema';
import { approveTaskCore, handleNodeExecutionError } from '../../../services/workflow-instances.service';
import { httpRequest } from '../../http-client';
import logger from '../../logger';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobError } from '../errors';
import type { WorkflowJobContext, WorkflowJobResult } from '../types';
import { snapshotNodeConfig, requireNumber } from './shared';

const TIMEOUT_MS_DEFAULT = 10_000;
const ACTOR = { userId: 0, name: 'system:trigger' } as const;

type TaskRow = typeof workflowTasksTable.$inferSelect;
type InstRow = typeof workflowInstancesTable.$inferSelect;
type TriggerRunResult = {
  status: 'success' | 'failed';
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  requestUrl: string;
  requestMethod: string;
  requestBody: string | null;
};

function renderTemplate(template: string, formData: Record<string, unknown>, extras: Record<string, string> = {}): string {
  return template
    .replace(/\{\{form\.([^}]+)\}\}/g, (_, key) => {
      const v = formData[key.trim()];
      if (v === undefined || v === null || typeof v === 'object') return '';
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
      return '';
    })
    .replace(/\{\{([a-zA-Z_]\w*)\}\}/g, (_, key) => extras[key] ?? '');
}

function isDataMutationTrigger(t: WorkflowTriggerType): boolean {
  return t === 'updateData' || t === 'deleteData';
}

async function executeHttpTrigger(cfg: WorkflowTriggerNodeConfig, formData: Record<string, unknown>, extras: Record<string, string>): Promise<TriggerRunResult> {
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
  if (!url) {
    return { status: 'failed', responseStatus: null, responseBody: null, errorMessage: '未配置 webhookUrl', requestUrl: '', requestMethod: method, requestBody: bodyStr };
  }
  try {
    const resp = await httpRequest(url, { method, headers, body: bodyStr ?? undefined, timeout: cfg.timeoutMs ?? TIMEOUT_MS_DEFAULT });
    const respText = await resp.text().catch(() => '');
    return {
      status: resp.ok ? 'success' : 'failed',
      responseStatus: resp.status,
      responseBody: respText.slice(0, 4096),
      errorMessage: resp.ok ? null : `HTTP ${resp.status}`,
      requestUrl: url, requestMethod: method, requestBody: bodyStr,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', responseStatus: null, responseBody: null, errorMessage: msg.slice(0, 1024), requestUrl: url, requestMethod: method, requestBody: bodyStr };
  }
}

async function executeDataMutation(cfg: WorkflowTriggerNodeConfig, instanceId: number, formData: Record<string, unknown>): Promise<TriggerRunResult> {
  const fieldKeys = cfg.fieldKeys ?? [];
  const requestBody = JSON.stringify({ fieldKeys, fieldValues: cfg.fieldValues ?? null });
  try {
    const next = await db.transaction(async (tx) => {
      const [locked] = await tx.select({ formData: workflowInstances.formData }).from(workflowInstances)
        .where(eq(workflowInstances.id, instanceId)).for('update').limit(1);
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
    return { status: 'success', responseStatus: null, responseBody: JSON.stringify(next).slice(0, 4096), errorMessage: null, requestUrl: '', requestMethod: cfg.triggerType, requestBody };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', responseStatus: null, responseBody: null, errorMessage: msg.slice(0, 1024), requestUrl: '', requestMethod: cfg.triggerType, requestBody };
  }
}

async function runTrigger(cfg: WorkflowTriggerNodeConfig, task: TaskRow, inst: InstRow, attempt: number): Promise<TriggerRunResult> {
  const formData = (inst.formData ?? {}) as Record<string, unknown>;
  const triggerType = cfg.triggerType;
  if (triggerType === 'webhook' || triggerType === 'callback') {
    const extras: Record<string, string> = {
      idempotencyKey: `workflow-trigger:${task.id}:${attempt}`,
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
    return executeDataMutation(cfg, inst.id, formData);
  }
  return { status: 'failed', responseStatus: null, responseBody: null, errorMessage: `未知触发器类型 ${triggerType as string}`, requestUrl: '', requestMethod: '', requestBody: null };
}

function toDetail(r: TriggerRunResult): WorkflowJobResult {
  return { requestUrl: r.requestUrl || null, requestMethod: r.requestMethod || null, requestBody: r.requestBody, responseStatus: r.responseStatus, responseBody: r.responseBody };
}

/**
 * trigger_dispatch：触发器节点执行（webhook/callback/updateData/deleteData）。
 * 取代 trigger.ts 的 dispatch/claim/mark/recover；attempts/退避/死信交给引擎，执行明细入 job_executions。
 * payload: { taskId }
 */
async function handle({ payload, attempt, job }: WorkflowJobContext): Promise<WorkflowJobResult | void> {
  const taskId = (() => {
    try { return requireNumber(payload, 'taskId'); } catch { return NaN; }
  })();
  if (!Number.isFinite(taskId)) throw new WorkflowJobError('trigger_dispatch: payload.taskId 缺失', { permanent: true });

  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task || task.nodeType !== 'trigger') throw new WorkflowJobSkip('触发器任务不存在或类型不符');
  if (task.status !== 'waiting' && task.status !== 'approved') throw new WorkflowJobSkip('触发器任务已结束');
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst || inst.status !== 'running') throw new WorkflowJobSkip('实例不在运行中');

  const cfg = snapshotNodeConfig(inst, task.nodeKey)?.triggerConfig;
  if (!cfg) {
    await handleNodeExecutionError({ instance: inst, task, nodeKey: task.nodeKey, nodeName: task.nodeName, errorMessage: '触发器节点缺少 triggerConfig', actor: ACTOR });
    throw new WorkflowJobError('触发器节点缺少 triggerConfig', { permanent: true });
  }

  const triggerType = cfg.triggerType;
  const result = await runTrigger(cfg, task, inst, attempt);
  const detail = toDetail(result);

  if (result.status === 'success') {
    const shouldAdvance = task.status === 'waiting' && triggerType !== 'callback'
      && ((cfg.onFailure ?? 'continue') === 'block' || isDataMutationTrigger(triggerType));
    if (shouldAdvance) {
      await approveTaskCore(task, inst, '触发器执行成功，自动推进', ACTOR);
    }
    return detail;
  }

  // 失败：未到最大尝试 → 抛出可重试错误（引擎按退避重排）
  const errorMessage = result.errorMessage ?? '触发器执行失败';
  if (attempt < job.maxAttempts) {
    throw new WorkflowJobError(errorMessage, { detail });
  }
  // 最后一次失败：路由流程（block/continue/exception），再死信留痕
  if (task.status === 'waiting') {
    const handled = await handleNodeExecutionError({ instance: inst, task, nodeKey: task.nodeKey, nodeName: task.nodeName, errorMessage, actor: ACTOR });
    if (!handled) {
      logger.warn('[trigger] 阻塞触发器执行失败，流程已阻塞，等待人工处理', { instanceId: inst.id, nodeKey: task.nodeKey, attempt, error: errorMessage });
    }
  }
  throw new WorkflowJobError(errorMessage, { detail, permanent: true });
}

registerJobHandler('trigger_dispatch', handle);
