import type { WorkflowEvent } from '@zenith/shared/workflow';
import { findMatchingSubscriptions } from '../../../services/workflow/workflow-event-subscriptions.service';
import { enqueueJob } from '../engine';
import { registerJobHandler } from '../registry';
import { WorkflowJobPermanentError } from '../errors';
import type { WorkflowJobContext } from '../types';
import { workflowEventBus } from '../../workflow-event-bus';
import { workflowTransaction } from '../lease';

/** webhook 投递最大尝试次数（对齐旧的 5 段退避） */
const WEBHOOK_MAX_ATTEMPTS = 5;

/**
 * event_dispatch：工作流事件的统一可靠投递（事务性 outbox 的消费端）。
 * 事件由各业务事务内持久入队，本作业由统一 worker 消费，崩溃后可恢复：
 *  ① 派发到进程内订阅者（ws / 通知 / 会话 / 自动化 / 业务桥接 / 节点监听，best-effort）；
 *  ② 为每个匹配的 Webhook 订阅入队独立 webhook_delivery 作业（各自重试/死信）。
 * idempotencyKey=event:{eventId} 仅去重作业入库；订阅者仍需按 eventId 幂等处理重复尝试。
 * payload: { event }
 */
async function handle({ payload }: WorkflowJobContext): Promise<void> {
  const event = payload.event as WorkflowEvent | undefined;
  if (!event || typeof event !== 'object') {
    throw new WorkflowJobPermanentError('event_dispatch: payload.event 缺失');
  }

  // ① 进程内订阅者（durable）：best-effort，单个订阅失败不影响其它，也不使作业失败
  await workflowEventBus.dispatchInProcess(event);

  // ② Webhook 持久化扇出
  const subs = await findMatchingSubscriptions({
    definitionId: event.definitionId ?? 0,
    eventType: event.type,
    tenantId: event.tenantId ?? null,
  });
  await workflowTransaction(async (tx) => {
  for (const sub of subs) {
    await enqueueJob({
      jobType: 'webhook_delivery',
      instanceId: event.instanceId ?? null,
      taskId: 'task' in event ? event.task.id : null,
      payload: { subscriptionId: sub.id, event },
      tenantId: event.tenantId ?? null,
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      idempotencyKey: `webhook:${event.eventId}:${sub.id}`,
      traceId: event.eventId,
    }, tx);
  }
  });
}

registerJobHandler('event_dispatch', handle);
