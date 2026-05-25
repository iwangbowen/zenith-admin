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
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowInstances, workflowTasks } from '../../db/schema';
import { workflowEventBus } from '../workflow-event-bus';
import { insertTriggerExecution } from '../../services/workflow-trigger-executions.service';
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
  const next: Record<string, unknown> = { ...formData };
  const fieldKeys = cfg.fieldKeys ?? [];
  if (cfg.triggerType === 'updateData') {
    const values = cfg.fieldValues ?? {};
    for (const key of fieldKeys) {
      const template = values[key];
      next[key] = template === undefined ? null : renderTemplate(template, formData);
    }
  } else if (cfg.triggerType === 'deleteData') {
    for (const key of fieldKeys) {
      delete next[key];
    }
  }
  const requestBody = JSON.stringify({ fieldKeys, fieldValues: cfg.fieldValues ?? null });
  try {
    await db.update(workflowInstances).set({ formData: next }).where(eq(workflowInstances.id, instanceId));
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

async function dispatchTrigger(instanceId: number, nodeKey: string, nodeName: string): Promise<void> {
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

  let result: Awaited<ReturnType<typeof executeHttpTrigger>>;
  if (triggerType === 'webhook' || triggerType === 'callback') {
    const extras: Record<string, string> = {};
    if (triggerType === 'callback' && task?.externalCallbackId) {
      const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
      extras.callbackUrl = `${base}/api/public/workflow/trigger-callback/${task.externalCallbackId}`;
      extras.callbackId = task.externalCallbackId;
    }
    result = await executeHttpTrigger(cfg, formData, extras);
  } else if (triggerType === 'updateData' || triggerType === 'deleteData') {
    const m = await executeDataMutation(cfg, instanceId, formData);
    result = {
      status: m.status,
      responseStatus: null,
      responseBody: m.responseBody,
      errorMessage: m.errorMessage,
      durationMs: m.durationMs,
      requestUrl: '',
      requestMethod: triggerType,
      requestBody: m.requestBody,
    };
  } else {
    result = {
      status: 'failed',
      responseStatus: null,
      responseBody: null,
      errorMessage: `未知触发器类型 ${triggerType as string}`,
      durationMs: 0,
      requestUrl: '',
      requestMethod: '',
      requestBody: null,
    };
  }

  await insertTriggerExecution({
    instanceId,
    taskId,
    nodeKey,
    nodeName,
    triggerType,
    status: result.status === 'success' ? 'success' : 'failed',
    attempt: 1,
    requestUrl: result.requestUrl || null,
    requestMethod: result.requestMethod || null,
    requestBody: result.requestBody,
    responseStatus: result.responseStatus,
    responseBody: result.responseBody,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs,
    tenantId: inst.tenantId ?? null,
  });
}

export function registerTriggerWorkflowSubscriber(): void {
  workflowEventBus.on('node.entered', (event) => {
    if (event.nodeType !== 'trigger') return;
    void dispatchTrigger(event.instanceId, event.nodeKey, event.nodeName).catch((err) => {
      logger.error('[trigger-subscriber] dispatch failed', { instanceId: event.instanceId, nodeKey: event.nodeKey, err });
    });
  });
}
