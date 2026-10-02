import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowPredictedPathNode, WorkflowTask } from '@zenith/shared/workflow';
import ApprovalTimeline from './ApprovalTimeline';

vi.mock('@/components/FileAttachment', () => ({ default: () => null }));

const completedTask: WorkflowTask = {
  id: 1, instanceId: 1, nodeKey: 'finance', nodeName: '财务审批', nodeType: 'approve',
  activationId: 'first-round', slotId: 1, taskKind: 'approval', waitReason: null,
  activatedAt: null, signPosition: null, assigneeId: 2, assigneeName: '王财务',
  status: 'approved', comment: null, actionAt: null, createdAt: '2026-10-02 08:00:00',
};

describe('remaining approval timeline', () => {
  it('keeps a predicted new pass through an already completed node and shows real estimated names', () => {
    const flowNodes: WorkflowPredictedPathNode[] = [{
      key: 'finance', name: '财务审批', type: 'approve', status: 'matched',
      estimatedApprovers: [{ id: 3, name: '赵财务' }], approverReason: '按当前财务角色解析',
    }];
    render(<ApprovalTimeline tasks={[completedTask]} flowNodes={flowNodes} instanceStatus="running" />);

    expect(screen.getAllByText('财务审批')).toHaveLength(2);
    expect(screen.getByText('预计经过')).toBeInTheDocument();
    expect(screen.getByText('预计处理人：赵财务')).toBeInTheDocument();
    expect(screen.getByText('按当前财务角色解析')).toBeInTheDocument();
  });

  it('omits excluded branches and explains uncertain future routing', () => {
    render(<ApprovalTimeline tasks={[]} instanceStatus="running" flowNodes={[
      { key: 'legal', name: '法务复核', type: 'approve', status: 'unknown', reason: '上游节点还可调整金额', approverReason: '角色将在运行时解析' },
      { key: 'audit', name: '审计审批', type: 'approve', status: 'excluded' },
    ]} />);

    expect(screen.queryByText('审计审批')).not.toBeInTheDocument();
    expect(screen.getByText('待条件确认')).toBeInTheDocument();
    expect(screen.getByText('上游节点还可调整金额')).toBeInTheDocument();
    expect(screen.getByText('角色将在运行时解析')).toBeInTheDocument();
  });

  it('does not duplicate completed tasks when only an unpredicted structure fallback is available', () => {
    render(<ApprovalTimeline tasks={[completedTask]} flowNodes={[{ key: 'finance', name: '财务审批', type: 'approve' }]} instanceStatus="running" />);
    expect(screen.getAllByText('财务审批')).toHaveLength(1);
  });
});
