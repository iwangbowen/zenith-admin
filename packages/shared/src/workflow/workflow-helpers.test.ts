/**
 * 工作流共享纯逻辑单测：表单快照归一化、健康巡检汇总。
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowHealthIssue } from './contracts/health';
import type { WorkflowFlowData, WorkflowNodeConfig } from './types';
import { sortWorkflowHealthIssues, summarizeWorkflowHealth } from './health';
import { findNextApproverSelectNodes, normalizeWorkflowFormSnapshot } from './helpers';

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

describe('findNextApproverSelectNodes', () => {
  const node = (id: string, data: Partial<WorkflowNodeConfig> & { type: WorkflowNodeConfig['type'] }): WorkflowFlowData['nodes'][number] => ({
    id, type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: id, label: id, ...data },
  });
  const condition = (field: string, value: string) => [{ type: 'and' as const, rules: [{ field, operator: 'eq' as const, value }] }];
  const flow: WorkflowFlowData = {
    nodes: [
      node('start', { type: 'start' }),
      node('alloc', { type: 'approve', assigneeType: 'user' }),
      node('gw', { type: 'exclusiveGateway' }),
      node('chuzhi', { type: 'approve', assigneeType: 'approverSelect' }),
      node('xietiao', { type: 'approve', assigneeType: 'user' }),
      node('end', { type: 'end' }),
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'alloc' },
      { id: 'e2', source: 'alloc', target: 'gw' },
      { id: 'e3', source: 'gw', target: 'chuzhi', conditions: condition('action', '正常') },
      { id: 'e4', source: 'gw', target: 'xietiao', conditions: condition('action', '疑难') },
      { id: 'e5', source: 'gw', target: 'end', isDefault: true },
      { id: 'e6', source: 'chuzhi', target: 'end' },
      { id: 'e7', source: 'xietiao', target: 'end' },
    ],
  };

  it('只收集命中分支上的 approverSelect（未经过的分支不再强制选人）', () => {
    expect(findNextApproverSelectNodes(flow, 'alloc', { formData: { action: '疑难' } })).toEqual([]);
    expect(findNextApproverSelectNodes(flow, 'alloc', { formData: { action: '正常' } }).map((n) => n.data.key)).toEqual(['chuzhi']);
  });

  it('条件值未知时保守地仍要求选人（undefined / 空表单）', () => {
    expect(findNextApproverSelectNodes(flow, 'alloc').map((n) => n.data.key)).toEqual(['chuzhi']);
  });

  it('并行网关仍收集全部分支的 approverSelect', () => {
    const parallel: WorkflowFlowData = {
      nodes: flow.nodes.map((n) => {
        if (n.id === 'gw') return { ...n, data: { ...n.data, type: 'parallelGateway' as const } };
        if (n.id === 'xietiao') return { ...n, data: { ...n.data, assigneeType: 'approverSelect' as const } };
        return n;
      }),
      edges: [
        { id: 'p1', source: 'start', target: 'alloc' },
        { id: 'p2', source: 'alloc', target: 'gw' },
        { id: 'p3', source: 'gw', target: 'chuzhi' },
        { id: 'p4', source: 'gw', target: 'xietiao' },
        { id: 'p5', source: 'chuzhi', target: 'end' },
        { id: 'p6', source: 'xietiao', target: 'end' },
      ],
    };
    expect(findNextApproverSelectNodes(parallel, 'alloc', { formData: {} }).map((n) => n.data.key)).toEqual(['chuzhi', 'xietiao']);
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
