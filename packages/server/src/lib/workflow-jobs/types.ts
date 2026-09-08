import type { WorkflowJobRow } from '../../db/schema';

/** 统一作业队列（pg-boss queue 名）—— 所有 jobType 共用一个 Worker 消费 */
export const WORKFLOW_JOB_QUEUE = 'workflow-jobs';
/** 兜底扫描 + 崩溃恢复的周期任务名 */
export const WORKFLOW_JOB_DRAIN_TASK = 'workflow-jobs-drain';

export const WORKFLOW_JOB_LEASE_MS = 60_000;
export const WORKFLOW_JOB_HEARTBEAT_MS = 15_000;
export const WORKFLOW_JOB_EXECUTION_TIMEOUT_MS = 10 * 60_000;

/** HTTP 类作业（trigger/external/webhook）回填的执行明细，写入 workflow_job_executions */
export interface WorkflowJobExecutionDetail {
  requestUrl?: string | null;
  requestMethod?: string | null;
  requestBody?: string | null;
  responseStatus?: number | null;
  responseBody?: string | null;
}

/** handler 正常返回值：附带执行明细与可选结果 */
export interface WorkflowJobResult extends WorkflowJobExecutionDetail {
  /** 写入 workflow_jobs.result，供审计 / trace 串联 */
  result?: Record<string, unknown> | null;
}

/** handler 执行上下文 */
export interface WorkflowJobContext {
  job: WorkflowJobRow;
  /** 当前尝试序号（1-based，等于领取时自增后的 attempts） */
  attempt: number;
  /** job.payload（已断言为对象） */
  payload: Record<string, unknown>;
  generation: number;
  leaseToken: string;
  executionId: number;
  executionDeadline: Date;
  operationKey: string;
  signal: AbortSignal;
}

/**
 * 单个 jobType 的处理器。
 * - 正常返回 → 作业成功（succeeded）。
 * - throw WorkflowJobSkip → 视为成功的 no-op（工作已被其它路径完成，不重试）。
 * - throw WorkflowJobPermanentError → 直接进死信（dead，不重试）。
 * - throw 其它错误 → 失败：attempts < maxAttempts 时按退避重试，否则进死信。
 */
export type WorkflowJobHandler = (ctx: WorkflowJobContext) => Promise<WorkflowJobResult | void>;
