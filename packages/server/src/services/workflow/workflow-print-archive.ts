/** The event consumer saves a TaskCenter intent; PDF rendering stays outside the event transaction. */
import { registerTaskHandler, persistSystemAsyncTask, enqueueAsyncTask } from '../../lib/task-center';
import { rememberTransactionEffect } from '../../lib/transaction-effects';
import { registerWorkflowEventConsumer } from '../../lib/workflow-event-consumer';
import { loadDefinitionPrintConfig } from './workflow-print-config';

export const WORKFLOW_PRINT_ARCHIVE_QUEUE = 'workflow-print-archive';
let declared = false;
export async function registerWorkflowPrintArchiveWorker(): Promise<void> {
  if (declared) return;
  declared = true;
  registerTaskHandler({ taskType: WORKFLOW_PRINT_ARCHIVE_QUEUE, title: '审批单归档件生成', module: '工作流',
    allowConcurrent: true, maxAttempts: 3, retryDelayMs: 5000,
    async run(ctx) {
      const { archiveWorkflowInstancePrint } = await import('./workflow-print.service');
      return archiveWorkflowInstancePrint(Number(ctx.payload.instanceId), {
        expectedStatus: String(ctx.payload.expectedStatus), expectedUpdatedAt: String(ctx.payload.expectedUpdatedAt),
      });
    },
  });
}
export function registerWorkflowPrintArchiveSubscriber(): void {
  registerWorkflowEventConsumer('workflow.archive', ['instance.approved', 'instance.rejected'], async (tx, event) => {
    const print = await loadDefinitionPrintConfig(event.definitionId, tx);
    if (!print.settings.autoArchive) return { outcome: 'skipped', reason: 'automatic print archive disabled' };
    const task = await persistSystemAsyncTask(tx, { taskType: WORKFLOW_PRINT_ARCHIVE_QUEUE, title: `审批单归档：${event.instance.title}`,
      tenantId: event.tenantId, subjectRefs: [{ type: 'workflow.instance', key: String(event.instanceId), role: 'primary' }],
      payload: { instanceId: event.instanceId, eventId: event.eventId, expectedStatus: event.instance.status, expectedUpdatedAt: event.instance.updatedAt },
      idempotencyKey: `workflow-archive:${event.eventId}`,
    }, event.tenantId);
    rememberTransactionEffect(tx, `workflow-archive:${task.id}`, () => enqueueAsyncTask(task.id));
    return { outcome: 'handed_off', refs: { taskId: task.id } };
  });
}
