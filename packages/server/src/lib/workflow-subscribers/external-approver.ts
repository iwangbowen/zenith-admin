/**
 * 外部审批订阅者
 *
 * 监听 task.created，当任务 externalCallbackId 存在（即 approve 节点配置了 externalApproval.enabled），
 * 调用外部审批 URL，附带 callbackId / callbackPath / instance / task 摘要 + HMAC 签名。
 * 外部系统收到后通过 /api/public/workflow/external-callback/:callbackId 回调审批结果。
 */
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowInstances, workflowTasks } from '../../db/schema';
import { workflowEventBus } from '../workflow-event-bus';
import { httpPost } from '../http-client';
import logger from '../logger';
import type { WorkflowFlowData, WorkflowExternalApprovalConfig } from '@zenith/shared';

const TIMEOUT_MS_DEFAULT = 10_000;
const CALLBACK_PATH_PREFIX = '/api/public/workflow/external-callback';

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function dispatchExternalApproval(taskId: number): Promise<void> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task || !task.externalCallbackId) return;
  if (task.externalDispatchStatus === 'dispatched') return;

  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) return;
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const nodeCfg = snapshot?.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  const ext: WorkflowExternalApprovalConfig | undefined = nodeCfg?.externalApproval;

  if (!ext?.enabled || !ext.url) {
    await db.update(workflowTasks).set({ externalDispatchStatus: 'failed' }).where(eq(workflowTasks.id, taskId));
    logger.warn('[external-approver] 缺少 externalApproval 配置', { taskId });
    return;
  }

  const payload = {
    callbackId: task.externalCallbackId,
    callbackPath: `${CALLBACK_PATH_PREFIX}/${task.externalCallbackId}`,
    instance: {
      id: inst.id,
      title: inst.title,
      initiatorId: inst.initiatorId,
      formData: inst.formData ?? null,
    },
    task: {
      id: task.id,
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
    },
  };
  const bodyStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Zenith-Event': 'external-approval.requested',
    'X-Zenith-Callback-Id': task.externalCallbackId,
  };
  if ((ext.signMode ?? 'hmacSha256') === 'hmacSha256' && ext.secret) {
    headers['X-Zenith-Signature'] = `t=${timestamp},v1=${sign(ext.secret, timestamp, bodyStr)}`;
  }

  try {
    const resp = await httpPost(ext.url, bodyStr, { headers, timeout: ext.timeoutMs ?? TIMEOUT_MS_DEFAULT });
    if (resp.ok) {
      await db.update(workflowTasks).set({ externalDispatchStatus: 'dispatched' }).where(eq(workflowTasks.id, taskId));
    } else {
      await db.update(workflowTasks).set({ externalDispatchStatus: 'failed' }).where(eq(workflowTasks.id, taskId));
      logger.warn('[external-approver] 外部审批服务返回非 2xx', { taskId, status: resp.status });
    }
  } catch (err) {
    await db.update(workflowTasks).set({ externalDispatchStatus: 'failed' }).where(eq(workflowTasks.id, taskId));
    logger.error('[external-approver] 调用外部审批服务失败', { taskId, err });
  }
}

export function registerExternalApproverSubscriber(): void {
  workflowEventBus.on('task.created', (event) => {
    if (!event.task.externalCallbackId) return;
    void dispatchExternalApproval(event.task.id).catch((err) => {
      logger.error('[external-approver] dispatch failed', { taskId: event.task.id, err });
    });
  });
}
