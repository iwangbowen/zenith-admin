/**
 * 工作流统一作业账本（workflow_jobs）公共入口。
 *
 * 设计：所有"系统级异步动作"（延时唤醒 / 审批超时 / 触发器派发 / 外部审批 /
 * 子流程发起·汇聚 / 事件派发 / Webhook 投递）统一入队到 workflow_jobs，
 * 由单个 pg-boss Worker 消费；周期 reconciler 只负责补投与崩溃恢复。
 *
 * 写侧：materialization / 事件发射处调用 enqueueJob()（可在事务内）。
 * 读侧：监控 / 死信中心按 status、jobType 聚合 workflow_jobs。
 */
export {
  enqueueJob,
  cancelJobs,
  retryJob,
  skipJob,
  drainWorkflowJobs,
  previewDrainableJobs,
  expiredWorkflowJobCondition,
  pauseInstanceJobs,
  resumeInstanceJobs,
  registerWorkflowJobWorker,
  scheduleJobPickup,
  WORKFLOW_ADVANCING_JOB_TYPES,
  type EnqueueJobInput,
  type DrainableFilter,
} from './engine';

export { WORKFLOW_JOB_QUEUE, WORKFLOW_JOB_DRAIN_TASK } from './types';
export { assertWorkflowJobOwnership, withWorkflowJobTransaction, currentWorkflowJobContext, runWithWorkflowJobContext, workflowTransaction } from './lease';
export type {
  WorkflowJobContext,
  WorkflowJobHandler,
  WorkflowJobResult,
  WorkflowJobExecutionDetail,
} from './types';
export { WorkflowJobSkip, WorkflowJobPermanentError, WorkflowJobLeaseLostError, WorkflowJobDeadlineError } from './errors';
export { computeBackoffMs, computeNextRunAt } from './backoff';
