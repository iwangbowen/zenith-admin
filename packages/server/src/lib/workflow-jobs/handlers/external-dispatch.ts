import { eq } from 'drizzle-orm';
import type { WorkflowExternalApprovalConfig } from '@zenith/shared';
import { db } from '../../../db';
import { workflowTasks, workflowInstances } from '../../../db/schema';
import { approveTaskByCallback, rejectTaskByCallback, handleNodeExecutionError } from '../../../services/workflow-instances.service';
import { httpPost } from '../../http-client';
import logger from '../../logger';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobError } from '../errors';
import type { WorkflowJobContext, WorkflowJobResult } from '../types';
import { signHmac, snapshotNodeConfig, requireNumber } from './shared';

const TIMEOUT_MS_DEFAULT = 10_000;
const CALLBACK_PATH_PREFIX = '/api/public/workflow/external-callback';
const FALLBACK_COMMENT = '[系统] 外部审批服务调用失败，按节点 fallbackStrategy 自动处理';
const ACTOR = { userId: 0, name: 'system:external-approver' } as const;

/** 调用失败兜底：按 fallbackStrategy 自动通过/拒绝（manual 则保持待人工） */
async function applyFallback(callbackId: string, strategy: WorkflowExternalApprovalConfig['fallbackStrategy'] = 'manual'): Promise<void> {
  if (strategy === 'manual') return;
  try {
    if (strategy === 'autoApprove') await approveTaskByCallback(callbackId, FALLBACK_COMMENT, 'fallback');
    else if (strategy === 'autoReject') await rejectTaskByCallback(callbackId, FALLBACK_COMMENT, 'fallback');
  } catch (err) {
    logger.error('[external-approver] fallback 执行失败', { callbackId, strategy, err });
  }
}

/**
 * external_dispatch：调用外部审批服务，外部系统再回调推进。
 * 取代 external-approver.ts 的 dispatch/claim/recover；attempts/退避/死信交给引擎。
 * payload: { taskId }
 */
async function handle({ payload, attempt, job }: WorkflowJobContext): Promise<WorkflowJobResult | void> {
  const taskId = (() => { try { return requireNumber(payload, 'taskId'); } catch { return NaN; } })();
  if (!Number.isFinite(taskId)) throw new WorkflowJobError('external_dispatch: payload.taskId 缺失', { permanent: true });

  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task?.externalCallbackId) throw new WorkflowJobSkip('任务无外部回调 ID');
  if (task.status !== 'waiting') throw new WorkflowJobSkip('外部审批任务已结束');
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst || inst.status !== 'running') throw new WorkflowJobSkip('实例不在运行中');

  const ext = snapshotNodeConfig(inst, task.nodeKey)?.externalApproval;
  if (!ext?.enabled || !ext.url) {
    logger.warn('[external-approver] 缺少 externalApproval 配置', { taskId });
    const handled = await handleNodeExecutionError({ instance: inst, task, nodeKey: task.nodeKey, nodeName: task.nodeName, errorMessage: '外部审批配置缺失', actor: ACTOR });
    if (!handled) await applyFallback(task.externalCallbackId, ext?.fallbackStrategy);
    throw new WorkflowJobError('外部审批配置缺失', { permanent: true });
  }

  const payloadBody = {
    callbackId: task.externalCallbackId,
    callbackPath: `${CALLBACK_PATH_PREFIX}/${task.externalCallbackId}`,
    instance: { id: inst.id, title: inst.title, initiatorId: inst.initiatorId, formData: inst.formData ?? null },
    task: { id: task.id, nodeKey: task.nodeKey, nodeName: task.nodeName },
  };
  const bodyStr = JSON.stringify(payloadBody);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Zenith-Event': 'external-approval.requested',
    'X-Zenith-Callback-Id': task.externalCallbackId,
  };
  if ((ext.signMode ?? 'hmacSha256') === 'hmacSha256' && ext.secret) {
    headers['X-Zenith-Signature'] = `t=${timestamp},v1=${signHmac(ext.secret, timestamp, bodyStr)}`;
  }

  const detailBase: WorkflowJobResult = { requestUrl: ext.url, requestMethod: 'POST', requestBody: bodyStr };
  let errorMessage: string;
  try {
    const resp = await httpPost(ext.url, bodyStr, { headers, timeout: ext.timeoutMs ?? TIMEOUT_MS_DEFAULT });
    const respText = await resp.text().catch(() => '');
    if (resp.ok) {
      // 派发成功：任务保持 waiting，等待外部回调
      return { ...detailBase, responseStatus: resp.status, responseBody: respText.slice(0, 4096) };
    }
    errorMessage = `外部审批服务返回 HTTP ${resp.status}`;
    detailBase.responseStatus = resp.status;
    detailBase.responseBody = respText.slice(0, 4096);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (attempt < job.maxAttempts) {
    throw new WorkflowJobError(errorMessage, { detail: detailBase });
  }
  // 最终失败：路由流程 + fallback，再死信留痕
  const handled = await handleNodeExecutionError({ instance: inst, task, nodeKey: task.nodeKey, nodeName: task.nodeName, errorMessage, actor: ACTOR });
  if (!handled) await applyFallback(task.externalCallbackId, ext.fallbackStrategy);
  throw new WorkflowJobError(errorMessage, { detail: detailBase, permanent: true });
}

registerJobHandler('external_dispatch', handle);
