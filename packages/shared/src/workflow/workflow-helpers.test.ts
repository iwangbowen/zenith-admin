/**
 * 工作流共享纯逻辑单测：表单快照归一化、健康巡检汇总。
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowHealthIssue } from './contracts/health';
import { sortWorkflowHealthIssues, summarizeWorkflowHealth } from './health';
import { normalizeWorkflowFormSnapshot } from './helpers';

describe('normalizeWorkflowFormSnapshot', () => {
  it('非对象与数组视为无快照', () => {
    expect(normalizeWorkflowFormSnapshot(null)).toBeNull();
    expect(normalizeWorkflowFormSnapshot(undefined)).toBeNull();
    expect(normalizeWorkflowFormSnapshot('x')).toBeNull();
    expect(normalizeWorkflowFormSnapshot([])).toBeNull();
  });

  it('补全缺省字段，fields 非数组时回落为空数组', () => {
    expect(normalizeWorkflowFormSnapshot({ formType: 'designer', fields: 'bad' })).toEqual({
      formType: 'designer', formId: null, formName: null, fields: [], settings: null, customForm: null,
    });
    const full = { formType: 'custom', formId: 3, formName: '请假单', fields: [{ key: 'days' }], settings: { a: 1 }, customForm: { url: '/x' } };
    expect(normalizeWorkflowFormSnapshot(full)).toEqual(full);
  });
});

const issue = (id: string, type: WorkflowHealthIssue['type'], severity: WorkflowHealthIssue['severity'], ageMinutes: number): WorkflowHealthIssue => ({
  id, type, severity, title: id, description: '', instanceId: null, ageMinutes, createdAt: '2026-01-01 00:00:00',
});

describe('summarizeWorkflowHealth', () => {
  const issues = [
    issue('a', 'waiting_task_stuck', 'warning', 40),
    issue('b', 'external_dispatch_failed', 'critical', 10),
    issue('c', 'trigger_waiting_no_execution', 'critical', 90),
    issue('d', 'subprocess_waiting', 'warning', 70),
    issue('e', 'workflow_event_outbox_failed', 'critical', 5),
    issue('f', 'trigger_execution_failed', 'warning', 60),
  ];

  it('critical 优先，其后按滞留时长倒序，且不修改入参', () => {
    const copy = [...issues];
    expect(sortWorkflowHealthIssues(issues).map((i) => i.id)).toEqual(['c', 'b', 'e', 'd', 'f', 'a']);
    expect(issues).toEqual(copy);
  });

  it('按类型归入四类统计，healthy 仅在无问题时为真', () => {
    const summary = summarizeWorkflowHealth(issues, { thresholdMinutes: 30, checkedAt: '2026-01-01 00:10:00' });
    expect(summary).toMatchObject({
      healthy: false,
      checkedAt: '2026-01-01 00:10:00',
      thresholdMinutes: 30,
      stats: { total: 6, critical: 3, warning: 3, externalFailed: 1, triggerStuck: 2, subProcessStuck: 1, outboxFailed: 1 },
    });
    expect(summary.issues.map((i) => i.id)).toEqual(['c', 'b', 'e', 'd', 'f', 'a']);
    expect(summarizeWorkflowHealth([], { thresholdMinutes: 30, checkedAt: 'now' }).healthy).toBe(true);
  });
});
