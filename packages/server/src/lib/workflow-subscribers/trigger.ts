/**
 * 触发器节点订阅者
 *
 * 监听 node.entered，当节点类型为 'trigger' 时执行配置的动作：
 * - webhook / callback：调用外部 HTTP 接口
 * - updateData：更新当前实例 formData 中指定字段
 * - deleteData：删除当前实例 formData 中指定字段
 *
 * 当前为非阻塞执行：流程已经在 expandTasksToRows 中往下推进，
 * 触发器仅产生 workflow_trigger_executions 跟踪记录。
 */
import { and, asc, eq, lte } from 'drizzle-orm';
import { db } from '../../db';
import { workflowInstances, workflowTasks, workflowTriggerExecutions } from '../../db/schema';
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

async function executeHttpTrigger(
  cfg: WorkflowTriggerNodeConfig,
  formData: Record<string, unknown>,
  extras: Record<string, string> = {},
): Promise<{ status: 'success' | 'failed'; responseStatus: number | null; responseBody: string | null; errorMessage: string | null; durationMs: number; requestUrl: string; requestMethod: string; requestBody: string | null }> {
  const url = cfg.webhookUrl ?? '';
  const method = (cfg.httpMethod ?? 'POST').toUpperCase() as 'GET' | 'POST' | 'PUT';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...cfg.headers };
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
): Promise<{ status: 'success' | 'failed'; responseBody: string | null; errorMessage: string | null; durationMs: number; requestBody: string }> {
  const t0 = Date.now();
  const fieldKeys = cfg.fieldKeys ?? [];
  const requestBody = JSON.stringify({ fieldKeys, fieldValues: cfg.fieldValues ?? null });
  try {
    // 事务 + 行级锁内重读 formData，避免并发触发器（如并行网关多分支）各自基于陈旧快照整体覆盖 jsonb 造成字段丢失
    const next = await db.transaction(async (tx) => {
      const [locked] = await tx.select({ formData: workflowInstances.formData })
        .from(workflowInstances).where(eq(workflowInstances.id, instanceId)).for('update').limit(1);
      const base = (locked?.formData ?? formData ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...base };
      if (cfg.triggerType === 'updateData') {
        const values = cfg.fieldValues ?? {};
        for (const key of fieldKeys) {
          const template = values[key];
          merged[key] = template === undefined ? null : renderTemplate(template, base);
        }
      } else if (cfg.triggerType === 'deleteData') {
        for (const key of fieldKeys) {
          delete merged[key];
        }
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

export async function dispatchTrigger(instanceId: number, nodeKey: string, nodeName: string): Promise<void> {
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId)).limit(1);
  if (!inst) return;
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  const node = flowData?.nodes.find((n) => n.data.key === nodeKey);
  const cfg = node?.data.triggerConfig;
  if (!cfg) {
    logger.warn('[trigger-subscriber] 触发器节点缺少 triggerConfig', { instanceId, nodeKey });
    return;
  }

  // 找到对应的占位 task（trigger 节点会在 expandTasksToRows 中生成一个无 assignee 的任务）
  const [task] = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeKey, nodeKey)))
    .orderBy(workflowTasks.id);
  const taskId = task?.nodeKey === nodeKey ? task.id : null;

  const formData = (inst.formData ?? {}) as Record<string, unknown>;
  const triggerType: WorkflowTriggerType = cfg.triggerType;
  const onFailure = cfg.onFailure ?? 'continue';

  const runOnce = async (): Promise<Awaited<ReturnType<typeof executeHttpTrigger>>> => {
    if (triggerType === 'webhook' || triggerType === 'callback') {
      const extras: Record<string, string> = {};
      if (triggerType === 'callback' && task?.externalCallbackId) {
        const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
        extras.callbackUrl = `${base}/api/public/workflow/trigger-callback/${task.externalCallbackId}`;
        extras.callbackId = task.externalCallbackId;
      }
      return executeHttpTrigger(cfg, formData, extras);
    }
    if (triggerType === 'updateData' || triggerType === 'deleteData') {
      const m = await executeDataMutation(cfg, instanceId, formData);
      return { status: m.status, responseStatus: null, responseBody: m.responseBody, errorMessage: m.errorMessage, durationMs: m.durationMs, requestUrl: '', requestMethod: triggerType, requestBody: m.requestBody };
    }
    return { status: 'failed', responseStatus: null, responseBody: null, errorMessage: `未知触发器类型 ${triggerType as string}`, durationMs: 0, requestUrl: '', requestMethod: '', requestBody: null };
  };

  // 失败重试：continue 不重试；retry/block 按 maxRetries 重试（含首次共 maxRetries+1 次）
  const maxAttempts = onFailure === 'continue' ? 1 : Math.min(11, Math.max(1, (cfg.maxRetries ?? 0) + 1));
  let result = await runOnce();
  let attempt = 1;
  while (result.status !== 'success' && attempt < maxAttempts) {
    await new Promise((r) => setTimeout(r, Math.min(5000, 500 * attempt)));
    attempt += 1;
    result = await runOnce();
  }

  await insertTriggerExecution({
    instanceId,
    taskId,
    nodeKey,
    nodeName,
    triggerType,
    status: result.status === 'success' ? 'success' : 'failed',
    attempt,
    requestUrl: result.requestUrl || null,
    requestMethod: result.requestMethod || null,
    requestBody: result.requestBody,
    responseStatus: result.responseStatus,
    responseBody: result.responseBody,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs,
    tenantId: inst.tenantId ?? null,
  });

  // onFailure='block'（非 callback）：触发器生成阻塞 waiting 任务，成功才推进，失败保持阻塞等待人工处理
  if (result.status !== 'success' && task && task.status === 'waiting') {
    const handled = await handleNodeExecutionError({
      instance: inst,
      task,
      nodeKey,
      nodeName,
      errorMessage: result.errorMessage ?? '触发器执行失败',
      actor: { userId: 0, name: 'trigger' },
    });
    if (handled) return;
  }

  if (onFailure === 'block' && triggerType !== 'callback' && task && task.status === 'waiting') {
    if (result.status === 'success') {
      await approveTaskCore(task, inst, '触发器执行成功，自动推进', { userId: 0, name: 'trigger:block' });
    } else {
      logger.warn('[trigger-subscriber] 阻塞触发器执行失败，流程已阻塞，等待人工处理', { instanceId, nodeKey, attempt, error: result.errorMessage });
    }
  }
}

export async function recoverPendingWorkflowTriggers(graceMinutes = 5, limit = 100): Promise<{ scanned: number; dispatched: number; skipped: number }> {
  const cutoff = new Date(Date.now() - graceMinutes * 60_000);
  const rows = await db.select({
    id: workflowTasks.id,
    instanceId: workflowTasks.instanceId,
    nodeKey: workflowTasks.nodeKey,
    nodeName: workflowTasks.nodeName,
  }).from(workflowTasks)
    .where(and(
      eq(workflowTasks.nodeType, 'trigger'),
      eq(workflowTasks.status, 'waiting'),
      lte(workflowTasks.createdAt, cutoff),
    ))
    .orderBy(asc(workflowTasks.createdAt))
    .limit(Math.max(1, Math.min(limit, 500)));

  let dispatched = 0;
  let skipped = 0;
  for (const row of rows) {
    const [existing] = await db.select({ id: workflowTriggerExecutions.id })
      .from(workflowTriggerExecutions)
      .where(eq(workflowTriggerExecutions.taskId, row.id))
      .limit(1);
    if (existing) {
      skipped += 1;
      continue;
    }
    try {
      await dispatchTrigger(row.instanceId, row.nodeKey, row.nodeName);
      dispatched += 1;
    } catch (err) {
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
