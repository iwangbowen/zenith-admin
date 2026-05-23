/**
 * 工作流事件 → WebSocket 推送订阅者（内置订阅者 #1）
 */
import { workflowEventBus } from '../workflow-event-bus';
import { sendToUser } from '../ws-manager';

export function registerWsWorkflowSubscriber(): void {
  workflowEventBus.on('task.created', (event) => {
    if (event.task.assigneeId) {
      sendToUser(event.task.assigneeId, {
        type: 'workflow:taskCreated',
        payload: {
          instanceId: event.instanceId,
          taskId: event.task.id,
          instanceTitle: event.task.nodeName,
          nodeName: event.task.nodeName,
        },
      });
    }
  });

  workflowEventBus.on('task.approved', (event) => {
    if (event.task.assigneeId) {
      sendToUser(event.task.assigneeId, {
        type: 'workflow:taskFinished',
        payload: { instanceId: event.instanceId, taskId: event.task.id, decision: 'approved' },
      });
    }
  });

  workflowEventBus.on('task.rejected', (event) => {
    if (event.task.assigneeId) {
      sendToUser(event.task.assigneeId, {
        type: 'workflow:taskFinished',
        payload: { instanceId: event.instanceId, taskId: event.task.id, decision: 'rejected' },
      });
    }
  });

  const pushInstanceFinished = (event: { instanceId: number; instance: { status: 'approved' | 'rejected' | 'withdrawn' | 'running' | 'draft'; title: string; initiatorId: number } }, status: 'approved' | 'rejected' | 'withdrawn') => {
    sendToUser(event.instance.initiatorId, {
      type: 'workflow:instanceFinished',
      payload: {
        instanceId: event.instanceId,
        status,
        title: event.instance.title,
      },
    });
  };

  workflowEventBus.on('instance.approved', (event) => pushInstanceFinished(event, 'approved'));
  workflowEventBus.on('instance.rejected', (event) => pushInstanceFinished(event, 'rejected'));
  workflowEventBus.on('instance.withdrawn', (event) => pushInstanceFinished(event, 'withdrawn'));
}
