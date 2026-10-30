/** Node listeners are independent outbound jobs; preparing them never executes HTTP. */
import { isPlainObject } from '@zenith/shared/core';
import { enqueueJob } from '../workflow-jobs/engine';
import { registerWorkflowEventConsumer } from '../workflow-event-consumer';

export function registerNodeListenersSubscriber(): void {
  registerWorkflowEventConsumer('workflow.node-listeners', ['task.created', 'task.approved', 'task.rejected'], async (tx, event, fact) => {
    const listenerEvent = { 'task.created': 'onCreate', 'task.approved': 'onApprove', 'task.rejected': 'onReject' }[event.type as 'task.created' | 'task.approved' | 'task.rejected'];
    const listeners = Array.isArray(fact.scope.nodeListeners) ? fact.scope.nodeListeners : [];
    const jobIds: number[] = [];
    for (const [position, listener] of listeners.entries()) {
      if (!isPlainObject(listener) || !Array.isArray(listener.events) || !listener.events.includes(listenerEvent)) continue;
      const job = await enqueueJob({ jobType: 'node_listener_delivery', instanceId: event.instanceId, taskId: event.task.id,
        nodeKey: event.task.nodeKey, tenantId: event.tenantId, maxAttempts: 3, executionTimeoutMs: 15_000,
        idempotencyKey: `node-listener:${event.eventId}:${position}`, traceId: event.eventId,
        payload: { event, listener, listenerEvent },
      }, tx);
      if (job) jobIds.push(job.id);
    }
    return jobIds.length ? { outcome: 'handed_off', refs: { jobIds } } : { outcome: 'skipped', reason: 'no matching node listeners' };
  });
}
