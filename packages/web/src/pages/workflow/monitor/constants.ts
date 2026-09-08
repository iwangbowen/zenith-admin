import type { WorkflowJobStatus } from '@zenith/shared/workflow';

export const WORKFLOW_ISSUE_SEVERITY_META = {
  info: { text: '信息', color: 'blue' },
  warning: { text: '警告', color: 'orange' },
  critical: { text: '严重', color: 'red' },
} as const;

export const WORKFLOW_JOB_STATUS_META: Record<
  WorkflowJobStatus,
  { text: string; color: 'grey' | 'blue' | 'green' | 'orange' | 'red' }
> & Record<string, { text: string; color: 'grey' | 'blue' | 'green' | 'orange' | 'red' }> = {
  pending: { text: '待处理', color: 'grey' },
  running: { text: '运行中', color: 'blue' },
  paused: { text: '已暂停', color: 'grey' },
  succeeded: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'orange' },
  dead: { text: '死信', color: 'red' },
  canceled: { text: '已取消', color: 'grey' },
};
