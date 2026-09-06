import { summarizeWorkflowHealth, workflowHealthContract, type WorkflowHealthIssue } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { mockWorkflowInstances, mockWorkflowTasks } from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';

function minutesAgoText(minutes: number): string {
  const d = new Date(Date.now() - minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const workflowHealthHandlers = [
  mock(workflowHealthContract.summary, ({ query, ok }) => {
    const thresholdMinutes = query.thresholdMinutes ?? 30;
    const issues: WorkflowHealthIssue[] = [];
    for (const task of mockWorkflowTasks) {
      if (task.status !== 'pending' && task.status !== 'waiting') continue;
      const inst = mockWorkflowInstances.find((item) => item.id === task.instanceId);
      if (!inst || inst.status !== 'running') continue;
      const age = Math.max(thresholdMinutes + 5, 35);
      if (task.status === 'waiting' || task.nodeType === 'trigger' || task.nodeType === 'subProcess') {
        issues.push({
          id: `mock-${task.id}`,
          type: task.nodeType === 'trigger' ? 'trigger_waiting_no_execution' : (task.nodeType === 'subProcess' ? 'subprocess_waiting' : 'waiting_task_stuck'),
          severity: task.nodeType === 'trigger' ? 'critical' : 'warning',
          title: task.nodeType === 'trigger' ? '触发器未生成执行记录' : '任务等待过久',
          description: 'Demo 巡检样例：该任务处于未完成状态且超过阈值。',
          instanceId: inst.id,
          instanceTitle: inst.title,
          taskId: task.id,
          nodeKey: task.nodeKey,
          nodeName: task.nodeName,
          status: task.status,
          ageMinutes: age,
          createdAt: task.createdAt ?? minutesAgoText(age),
        });
      }
    }
    return ok(summarizeWorkflowHealth(issues, { thresholdMinutes, checkedAt: mockDateTime() }));
  }),
];
