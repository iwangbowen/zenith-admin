import { describe, it, expect } from 'vitest';
import { analyzeWorkflowHealth } from './workflow-health';
import type { WorkflowFlowData } from '@zenith/shared/workflow';

/** 构造一个含网关条件 + 静态审批人的最小流程，用于校验 3D 增强（类型兼容 + 审批人可用性）。 */
function buildFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'start', type: 'start', data: { key: 'start', type: 'start', label: '开始' } },
      { id: 'gw', type: 'exclusiveGateway', data: { key: 'gw', type: 'exclusiveGateway', label: '网关' } },
      { id: 'ap', type: 'approve', data: { key: 'ap', type: 'approve', label: '审批', assigneeType: 'user', assigneeIds: [42] } },
      { id: 'end', type: 'end', data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { source: 'start', target: 'gw' },
      { source: 'gw', target: 'ap', condition: { field: 'remark', operator: 'gt', value: 5, source: 'form' } },
      { source: 'gw', target: 'end', isDefault: true },
      { source: 'ap', target: 'end' },
    ],
  } as unknown as WorkflowFlowData;
}

describe('analyzeWorkflowHealth 3D 增强', () => {
  it.each(['autoApprove', 'autoReject'] as const)('does not require people for an automatic %s node', approvalType => {
    const flow = buildFlow();
    flow.nodes[2].data = { key: 'ap', type: 'approve', label: '策略处理', approvalType };
    const report = analyzeWorkflowHealth(flow);
    expect(report.checks.find(check => check.key === 'approver')?.issues).toEqual([]);
  });

  it('排他网关条件区间重叠时告警', () => {
    const flow = {
      nodes: [
        { id: 'start', type: 'start', data: { key: 'start', type: 'start', label: '开始' } },
        { id: 'gw', type: 'exclusiveGateway', data: { key: 'gw', type: 'exclusiveGateway', label: '网关' } },
        { id: 'a', type: 'end', data: { key: 'a', type: 'end', label: 'A' } },
        { id: 'b', type: 'end', data: { key: 'b', type: 'end', label: 'B' } },
      ],
      edges: [
        { source: 'start', target: 'gw' },
        { source: 'gw', target: 'a', condition: { field: 'amt', operator: 'gt', value: 100, source: 'form' } },
        { source: 'gw', target: 'b', condition: { field: 'amt', operator: 'gt', value: 500, source: 'form' } },
      ],
    } as unknown as WorkflowFlowData;
    const report = analyzeWorkflowHealth(flow, new Set(['amt']), {});
    expect(report.checks.some((c) => c.issues.some((i) => i.message.includes('区间重叠')))).toBe(true);
  });

  it('对文本字段使用数值比较操作符时给出类型兼容性告警', () => {
    const report = analyzeWorkflowHealth(
      buildFlow(),
      new Set(['remark']),
      { fieldTypes: new Map([['remark', 'text']]) },
    );
    const expr = report.checks.find((c) => c.key === 'expression');
    expect(expr?.issues.some((i) => i.severity === 'warning' && i.message.includes('数值/大小比较'))).toBe(true);
  });

  it('数值字段使用数值比较操作符时不告警', () => {
    const report = analyzeWorkflowHealth(
      buildFlow(),
      new Set(['remark']),
      { fieldTypes: new Map([['remark', 'number']]) },
    );
    const expr = report.checks.find((c) => c.key === 'expression');
    expect(expr?.issues.some((i) => i.message.includes('数值/大小比较'))).toBe(false);
  });

  it('注入的审批人不可用信息会进入审批人维度告警', () => {
    const report = analyzeWorkflowHealth(
      buildFlow(),
      null,
      { approverAvailability: new Map([['ap', ['指定审批人「张三」已停用']]]) },
    );
    const approver = report.checks.find((c) => c.key === 'approver');
    expect(approver?.issues.some((i) => i.severity === 'warning' && i.message.includes('已停用'))).toBe(true);
  });

  it('不传增强参数时行为不变（无类型/可用性告警）', () => {
    const report = analyzeWorkflowHealth(buildFlow(), new Set(['remark']));
    const expr = report.checks.find((c) => c.key === 'expression');
    const approver = report.checks.find((c) => c.key === 'approver');
    expect(expr?.issues.some((i) => i.message.includes('数值/大小比较'))).toBe(false);
    expect(approver?.issues.some((i) => i.message.includes('已停用'))).toBe(false);
  });
});

/** 开始 → 审批 → 结束：审批节点是否配置超时由入参决定 */
function buildTimeoutFlow(timeout?: { enabled: boolean; duration: number; unit: 'hours'; action: 'remind' }): WorkflowFlowData {
  return {
    nodes: [
      { id: 'start', type: 'start', data: { key: 'start', type: 'start', label: '开始' } },
      {
        id: 'ap',
        type: 'approve',
        data: { key: 'ap', type: 'approve', label: '审批', assigneeType: 'user', assigneeIds: [42], ...(timeout ? { timeout } : {}) },
      },
      { id: 'end', type: 'end', data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { source: 'start', target: 'ap' },
      { source: 'ap', target: 'end' },
    ],
  } as unknown as WorkflowFlowData;
}

describe('超时/SLA 维度状态', () => {
  it('审批节点未配置超时时维度为 warn，而不是与扣分自相矛盾的 pass', () => {
    const report = analyzeWorkflowHealth(buildTimeoutFlow());
    const timeout = report.checks.find((c) => c.key === 'timeout')!;
    expect(timeout.issues).toHaveLength(1);
    expect(timeout.issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(timeout.status).toBe('warn');
    expect(timeout.score).toBeLessThan(100);
    expect(timeout.summary).toContain('未配置超时');
  });

  it('审批节点已配置超时时该维度为 pass 且无问题', () => {
    const report = analyzeWorkflowHealth(buildTimeoutFlow({ enabled: true, duration: 8, unit: 'hours', action: 'remind' }));
    const timeout = report.checks.find((c) => c.key === 'timeout')!;
    expect(timeout.issues).toHaveLength(0);
    expect(timeout.status).toBe('pass');
    expect(timeout.score).toBe(100);
  });
});
