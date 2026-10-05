import type { WorkflowEventDeliveryStatus, WorkflowJobExecutionStatus, WorkflowJobStatus } from './types';
import type { WORKFLOW_EVENT_DELIVERY_JOB_STATUSES } from './constants';

export type WorkflowEventDeliveryJobStatus = (typeof WORKFLOW_EVENT_DELIVERY_JOB_STATUSES)[number];

/** 投递执行事实与作业调度状态保持分离；服务端和 Demo 共享操作门禁。 */
export function workflowEventDeliveryState(input: {
  executionId: number;
  executionStatus: WorkflowJobExecutionStatus;
  latestExecutionId: number;
  latestExecutionStatus: WorkflowJobExecutionStatus;
  jobStatus: WorkflowJobStatus;
  jobAttempts: number;
  subscriptionEnabled: boolean;
}) {
  const outcomes: Record<WorkflowJobExecutionStatus, WorkflowEventDeliveryStatus> = {
    running: 'running', succeeded: 'success', failed: 'failed', skipped: 'skipped', canceled: 'cancelled',
  };
  let jobStatus: WorkflowEventDeliveryJobStatus;
  if (input.jobStatus === 'pending') jobStatus = input.jobAttempts > 0 ? 'retrying' : 'pending';
  else if (input.jobStatus === 'succeeded') jobStatus = input.latestExecutionStatus === 'skipped' ? 'skipped' : 'success';
  else if (input.jobStatus === 'canceled') jobStatus = 'cancelled';
  else jobStatus = input.jobStatus;
  const isLatestExecution = input.executionId === input.latestExecutionId;
  const actionable = input.subscriptionEnabled && isLatestExecution;
  const canRetry = actionable && (input.jobStatus === 'failed' || input.jobStatus === 'dead' || input.jobStatus === 'canceled');
  return {
    status: outcomes[input.executionStatus], jobStatus, isLatestExecution, canRetry,
    canReplay: actionable && (canRetry || input.jobStatus === 'succeeded'),
  };
}
