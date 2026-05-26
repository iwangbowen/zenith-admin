/**
 * 节点级监听器订阅者
 *
 * 与定义级订阅（workflow_event_subscriptions 表）相互独立：
 * - 监听器配置直接挂在 WorkflowNodeConfig.nodeListeners 上，由设计器维护
 * - 不持久化投递记录、不重试，仅记录日志
 * - 触发时机：task.created → onCreate；task.approved → onApprove；task.rejected → onReject
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowInstances } from '../../db/schema';
import type { NodeListenerConfig, NodeListenerEvent, WorkflowFlowData, WorkflowTaskEventPayload } from '@zenith/shared';
import { workflowEventBus } from '../workflow-event-bus';
import { httpGet, httpPost } from '../http-client';
import logger from '../logger';

const TIMEOUT_MS = 8_000;

const TASK_EVENT_TO_LISTENER: Partial<Record<WorkflowTaskEventPayload['type'], NodeListenerEvent>> = {
  'task.created': 'onCreate',
  'task.approved': 'onApprove',
  'task.rejected': 'onReject',
};

async function fireListener(listener: NodeListenerConfig, event: WorkflowTaskEventPayload, listenerEvent: NodeListenerEvent): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (listener.headers) Object.assign(headers, listener.headers);
  const payload = {
    eventId: event.eventId,
    eventType: event.type,
    listenerEvent,
    occurredAt: event.occurredAt,
    instanceId: event.instanceId,
    definitionId: event.definitionId,
    nodeKey: event.task.nodeKey,
    task: event.task,
    actor: event.actor,
    comment: event.comment ?? null,
  };
  try {
    if (listener.method === 'GET') {
      await httpGet(listener.url, { headers, timeoutMs: TIMEOUT_MS });
    } else {
      await httpPost(listener.url, payload, { headers, timeoutMs: TIMEOUT_MS });
    }
    logger.info('[workflow-node-listener] dispatched', { url: listener.url, eventId: event.eventId, listenerEvent });
  } catch (err) {
    logger.error('[workflow-node-listener] failed', { url: listener.url, eventId: event.eventId, listenerEvent, err: (err as Error).message });
  }
}

async function handleTaskEvent(event: WorkflowTaskEventPayload): Promise<void> {
  const listenerEvent = TASK_EVENT_TO_LISTENER[event.type];
  if (!listenerEvent) return;
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, event.instanceId)).limit(1);
  if (!inst) return;
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  const node = flowData?.nodes.find((n) => n.data.key === event.task.nodeKey);
  const listeners = node?.data.nodeListeners ?? [];
  for (const l of listeners) {
    if (l.events.includes(listenerEvent)) {
      void fireListener(l, event, listenerEvent);
    }
  }
}

export function registerNodeListenersSubscriber(): void {
  workflowEventBus.on('task.created', handleTaskEvent);
  workflowEventBus.on('task.approved', handleTaskEvent);
  workflowEventBus.on('task.rejected', handleTaskEvent);
  logger.info('[workflow-node-listener] subscriber registered');
}
