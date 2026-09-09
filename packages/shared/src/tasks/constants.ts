// ─── 导出中心 ────────────────────────────────────────────────────────────────

export const EXPORT_JOB_FORMATS = ['xlsx', 'csv', 'pdf', 'docx'] as const;

export type ExportJobFormat = (typeof EXPORT_JOB_FORMATS)[number];

export const EXPORT_JOB_STATUSES = ['pending', 'running', 'success', 'failed', 'cancelled', 'expired'] as const;

export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

/** 实际执行模式 */
export const EXPORT_JOB_EXECUTION_MODES = ['sync', 'async'] as const;

export type ExportJobExecutionMode = (typeof EXPORT_JOB_EXECUTION_MODES)[number];

/** 提交时请求的执行模式；`auto` 由服务端按行数与敏感度裁定 */
export const EXPORT_JOB_REQUEST_MODES = ['sync', 'async', 'auto'] as const;

export type ExportJobRequestMode = (typeof EXPORT_JOB_REQUEST_MODES)[number];

export const EXPORT_JOB_DELETE_REASONS = ['expired', 'manual', 'file_missing'] as const;

export type ExportJobDeleteReason = (typeof EXPORT_JOB_DELETE_REASONS)[number];

export const EXPORT_RENDER_MODES = ['table', 'layout', 'custom'] as const;

export type ExportRenderMode = (typeof EXPORT_RENDER_MODES)[number];

export const EXPORT_COLUMN_TYPES = ['string', 'number', 'datetime', 'date', 'enum', 'money', 'boolean'] as const;

export type ExportColumnType = (typeof EXPORT_COLUMN_TYPES)[number];

// ─── 任务中心 ────────────────────────────────────────────────────────────────

export const ASYNC_TASK_STATUSES = ['pending', 'running', 'success', 'failed', 'cancelled'] as const;

export type AsyncTaskStatus = (typeof ASYNC_TASK_STATUSES)[number];

/** 已进入终态（不再变化、可清理 / 重跑）的任务状态；server / web / mock 判定「任务是否结束」的唯一口径 */
export const ASYNC_TASK_TERMINAL_STATUSES = ['success', 'failed', 'cancelled'] as const satisfies readonly AsyncTaskStatus[];

export type AsyncTaskTerminalStatus = (typeof ASYNC_TASK_TERMINAL_STATUSES)[number];

/** 尚未结束（可取消 / 占用并发额度）的任务状态 */
export const ASYNC_TASK_ACTIVE_STATUSES = ['pending', 'running'] as const satisfies readonly AsyncTaskStatus[];

export function isAsyncTaskTerminal(status: string | null | undefined): status is AsyncTaskTerminalStatus {
  return (ASYNC_TASK_TERMINAL_STATUSES as readonly string[]).includes(status ?? '');
}

export const ASYNC_TASK_ITEM_STATUSES = ['pending', 'success', 'failed', 'skipped'] as const;

export type AsyncTaskItemStatus = (typeof ASYNC_TASK_ITEM_STATUSES)[number];

// ─── 演示任务 ────────────────────────────────────────────────────────────────

export const TASK_DEMO_TYPES = ['demo-batch', 'demo-serial'] as const;

export type TaskDemoType = (typeof TASK_DEMO_TYPES)[number];
