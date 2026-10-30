/** Optional online hints run only after the event receipt transaction commits. */
import type { WorkflowEvent } from '@zenith/shared/workflow';
import type { DbTransaction } from '../../db/types';
import { registerWorkflowEventConsumer } from '../workflow-event-consumer';
import { rememberTransactionEffect } from '../transaction-effects';
import { sendToUser } from '../ws-manager';
function push(tx: DbTransaction, event: WorkflowEvent, userId: number, message: Parameters<typeof sendToUser>[1]) {
  rememberTransactionEffect(tx, `workflow-ws:${event.eventId}:${userId}`, async () => { sendToUser(userId, message); });
}
export function registerWsWorkflowSubscriber(): void {
  registerWorkflowEventConsumer('workflow.ws', ['task.created', 'task.approved', 'task.rejected', 'instance.approved', 'instance.rejected', 'instance.withdrawn', 'instance.returned'],
    async (tx, event, fact) => {
      if ('task' in event) {
        if (!event.task.assigneeId) return { outcome: 'skipped', reason: 'no online recipient' };
        if (event.type === 'task.created' && event.task.status === 'pending') push(tx, event, event.task.assigneeId, {
          type: 'workflow:taskCreated', payload: { instanceId: event.instanceId, taskId: event.task.id, instanceTitle: String(fact.scope.label), nodeName: event.task.nodeName },
        });
        else if (event.type === 'task.approved' || event.type === 'task.rejected') push(tx, event, event.task.assigneeId, {
          type: 'workflow:taskFinished', payload: { instanceId: event.instanceId, taskId: event.task.id, decision: event.type === 'task.approved' ? 'approved' : 'rejected' },
        });
      } else if ('instance' in event) push(tx, event, event.instance.initiatorId, {
        type: 'workflow:instanceFinished', payload: { instanceId: event.instanceId, status: event.instance.status, title: event.instance.title },
      });
      return { outcome: 'completed' };
    });
}
