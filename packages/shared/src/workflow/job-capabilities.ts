import type { WorkflowJob } from './contracts/engine';

export function workflowJobCapabilities(job: Pick<WorkflowJob, 'status' | 'effectStatus'>): WorkflowJob['capabilities'] {
  const uncertain = job.effectStatus === 'sent_unknown';
  return { retry: ['failed', 'dead', 'canceled'].includes(job.status) && !uncertain, cancel: ['pending', 'running', 'paused', 'failed', 'dead'].includes(job.status) && !uncertain, confirmResult: uncertain, reason: uncertain ? '请先核对并确认外部结果' : null };
}
