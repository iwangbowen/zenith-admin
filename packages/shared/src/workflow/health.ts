import type { WorkflowHealthIssue, WorkflowHealthSummary } from './contracts/health';

/** 巡检问题排序：critical 优先，其后按滞留时长倒序（返回新数组） */
export function sortWorkflowHealthIssues(issues: readonly WorkflowHealthIssue[]): WorkflowHealthIssue[] {
  return [...issues].sort((a, b) => {
    const severity = (b.severity === 'critical' ? 1 : 0) - (a.severity === 'critical' ? 1 : 0);
    return severity || b.ageMinutes - a.ageMinutes;
  });
}

/**
 * 由问题列表汇总巡检结果：统计口径（按类型归入 外部派发 / 触发器 / 子流程 / outbox 四类）在此唯一定义，
 * 服务端巡检与 Demo Mock 共用，避免两侧统计不一致。
 */
export function summarizeWorkflowHealth(
  issues: readonly WorkflowHealthIssue[],
  meta: { thresholdMinutes: number; checkedAt: string },
): WorkflowHealthSummary {
  const sorted = sortWorkflowHealthIssues(issues);
  const critical = sorted.filter((issue) => issue.severity === 'critical').length;
  return {
    healthy: sorted.length === 0,
    checkedAt: meta.checkedAt,
    thresholdMinutes: meta.thresholdMinutes,
    stats: {
      total: sorted.length,
      critical,
      warning: sorted.length - critical,
      externalFailed: sorted.filter((issue) => issue.type === 'external_dispatch_failed').length,
      triggerStuck: sorted.filter((issue) => issue.type === 'trigger_waiting_no_execution' || issue.type === 'trigger_execution_failed').length,
      subProcessStuck: sorted.filter((issue) => issue.type === 'subprocess_waiting').length,
      outboxFailed: sorted.filter((issue) => issue.type === 'workflow_event_outbox_failed').length,
    },
    issues: sorted,
  };
}
