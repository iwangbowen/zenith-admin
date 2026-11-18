import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import type { WorkflowJobContext, WorkflowJobResult } from '../types';
import { approveTaskCore } from '../../../services/workflow/instances/task-actions';
import { WorkflowJobPermanentError } from '../errors';

/** Reconcile a verified external effect without repeating I/O or inventing a response body. */
export async function reconcileConfirmedExternalResult(context: WorkflowJobContext): Promise<WorkflowJobResult> {
  const { job } = context;
  if (!['trigger_dispatch', 'external_dispatch', 'webhook_delivery', 'node_listener_delivery'].includes(job.jobType)) throw new WorkflowJobPermanentError('此类作业不支持外部结果确认');
  if (job.jobType === 'trigger_dispatch' && job.taskId) {
    const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, job.taskId)).limit(1);
    const [instance] = task ? await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1) : [];
    const config = instance?.definitionSnapshot.flowData?.nodes.find(n => n.data.key === task.nodeKey)?.data.triggerConfig;
    if (task?.status === 'waiting' && instance?.status === 'running' && config?.triggerType !== 'callback') await approveTaskCore(task, instance, '外部结果已核对成功：' + job.effectEvidence, { userId: 0, name: 'system:verified-external-result' });
  }
  return { result: { reconciled: true, evidence: job.effectEvidence } };
}
