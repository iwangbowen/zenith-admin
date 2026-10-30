import { registerWorkflowEventConsumer } from '../../lib/workflow-event-consumer';
import { registerNotificationWorkflowSubscriber } from '../../lib/workflow-subscribers/notification';
import { registerChatWorkflowSubscriber } from '../../lib/workflow-subscribers/chat';
import { registerNodeListenersSubscriber } from '../../lib/workflow-subscribers/node-listeners';
import { registerWsWorkflowSubscriber } from '../../lib/workflow-subscribers/ws';
import { enqueueJob } from '../../lib/workflow-jobs/engine';
import { enqueueWorkflowAutomationsForEventWithin } from './workflow-automation-runtime';
import { findMatchingSubscriptions } from './workflow-event-subscriptions.service';
import { registerWorkflowPrintArchiveSubscriber } from './workflow-print-archive';

let registered = false;
export function registerWorkflowEventConsumers(): void {
  if (registered) return;
  registered = true;
  registerNotificationWorkflowSubscriber(); registerChatWorkflowSubscriber(); registerNodeListenersSubscriber();
  registerWsWorkflowSubscriber(); registerWorkflowPrintArchiveSubscriber();
  registerWorkflowEventConsumer('workflow.automations', ['instance.created', 'instance.approved', 'instance.rejected', 'instance.withdrawn'], async (tx, event) => {
    const result = await enqueueWorkflowAutomationsForEventWithin(tx, event);
    return result.jobId ? { outcome: 'handed_off', refs: { jobId: result.jobId } } : { outcome: 'skipped', reason: 'no automation actions' };
  });
  registerWorkflowEventConsumer('workflow.webhooks', ['instance.created', 'instance.approved', 'instance.rejected', 'instance.withdrawn', 'instance.returned',
    'task.created', 'task.assigned', 'task.approved', 'task.rejected', 'task.skipped', 'task.transferred', 'task.addSigned', 'task.reduceSigned', 'task.urged', 'node.entered', 'node.left'], async (tx, event) => {
    const subscriptions = await findMatchingSubscriptions({ definitionId: event.definitionId, eventType: event.type, tenantId: event.tenantId }, tx);
    const jobIds: number[] = [];
    for (const sub of subscriptions) {
      const job = await enqueueJob({ jobType: 'webhook_delivery', instanceId: event.instanceId,
        taskId: 'task' in event ? event.task.id : null, tenantId: event.tenantId, maxAttempts: 5,
        idempotencyKey: `webhook:${event.eventId}:${sub.id}`, traceId: event.eventId,
        payload: { subscriptionId: sub.id, event, subscriptionSnapshot: { url: sub.url, headers: sub.headers, signMode: sub.signMode, connectorId: sub.connectorId } },
      }, tx);
      if (job) jobIds.push(job.id);
    }
    return subscriptions.length ? { outcome: 'handed_off', refs: { jobIds } } : { outcome: 'skipped', reason: 'no matching workflow subscriptions' };
  });
}
