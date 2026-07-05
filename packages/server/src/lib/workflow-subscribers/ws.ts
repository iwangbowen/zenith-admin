/**
 * 工作流事件 → WebSocket 推送订阅者（内置订阅者 #1）
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowInstances } from '../../db/schema';
import { workflowEventBus } from '../workflow-event-bus';
import { sendToUser } from '../ws-manager';
import type { WorkflowInstanceStatus } from '@zenith/shared';

async function loadInstanceTitle(instanceId: number): Promise<string> {
  const [row] = await db
    .select({ title: workflowInstances.title, serialNo: workflowInstances.serialNo })
    .from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId))
    .limit(1);
  if (!row) return `流程 #${instanceId}`;
  return row.serialNo ? `${row.title}（${row.serialNo}）` : row.title;
}

export function registerWsWorkflowSubscriber(): void {
  workflowEventBus.on('task.created', async (event) => {
    if (event.task.assigneeId && event.task.status === 'pending') {
      sendToUser(event.task.assigneeId, {
        type: 'workflow:taskCreated',
        payload: {
          instanceId: event.instanceId,
          taskId: event.task.id,
          instanceTitle: await loadInstanceTitle(event.instanceId),
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

  const pushInstanceFinished = (event: { instanceId: number; instance: { status: WorkflowInstanceStatus; title: string; initiatorId: number } }, status: 'approved' | 'rejected' | 'withdrawn') => {
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
