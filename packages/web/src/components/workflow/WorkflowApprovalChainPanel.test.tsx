import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowApproverPreviewNode } from '@zenith/shared/workflow';
import { compactSelectedInitiatorApprovers, firstMissingInitiatorApproverNode, WorkflowApprovalChain } from './WorkflowApprovalChainPanel';

vi.mock('@/hooks/queries/workflow-shared', () => ({ useWorkflowApprovalPreview: vi.fn() }));

const manager: WorkflowApproverPreviewNode = {
  nodeKey: 'manager', nodeName: '部门审批', nodeType: 'approve', status: 'matched',
  approvers: [{ id: 2, name: '张主管' }], approverReason: '按发起人所在部门解析主管',
};
const excluded: WorkflowApproverPreviewNode = {
  nodeKey: 'finance', nodeName: '大额财务复核', nodeType: 'approve', status: 'excluded',
  reason: '报销金额未达到复核门槛', approvers: [{ id: 3, name: '王财务' }],
  // Even a stale preview response must not make an excluded branch required.
  selectionRequired: true, selectableApprovers: [{ id: 3, name: '王财务' }],
};
const unknown: WorkflowApproverPreviewNode = {
  nodeKey: 'legal', nodeName: '法务复核', nodeType: 'approve', status: 'unknown',
  reason: '主管审批时还可调整合同金额', approvers: [], selectionRequired: true,
  selectableApprovers: [{ id: 4, name: '李法务' }], approverReason: '到达节点时使用预选审批人',
};

describe('approval chain path prediction', () => {
  it('excludes unmatched branches from counts and required selections, including the full structure view', () => {
    const onNodesChange = vi.fn();
    render(<WorkflowApprovalChain nodes={[manager, excluded]} selectable onNodesChange={onNodesChange} />);

    expect(screen.getByText('共 1 步 · 约 1 人审批')).toBeInTheDocument();
    expect(screen.queryByText('大额财务复核')).not.toBeInTheDocument();
    expect(onNodesChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole('button', { name: '全部结构' }));
    expect(screen.getByText('大额财务复核')).toBeInTheDocument();
    expect(screen.getByText('不经过')).toBeInTheDocument();
    expect(screen.getByText('报销金额未达到复核门槛')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('共 1 步 · 约 1 人审批')).toBeInTheDocument();
    expect(compactSelectedInitiatorApprovers({ finance: [3] }, onNodesChange.mock.lastCall![0])).toBeUndefined();
  });

  it('explains uncertain branches and requires their potential approvers to be selected before launch', () => {
    const onNodesChange = vi.fn();
    render(<WorkflowApprovalChain nodes={[unknown]} selectable highlightMissing onNodesChange={onNodesChange} />);

    expect(screen.getByText('待条件确认')).toBeInTheDocument();
    expect(screen.getByText('条件未定，请预选可能需要的审批人')).toBeInTheDocument();
    expect(screen.getByText('主管审批时还可调整合同金额')).toBeInTheDocument();
    expect(screen.getByText('预计 1 步 · 1 步待条件确认 · 含自选')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '法务复核' })).toBeInTheDocument();
    const selectNodes = onNodesChange.mock.lastCall![0];
    expect(firstMissingInitiatorApproverNode({}, selectNodes)?.nodeKey).toBe('legal');
    expect(firstMissingInitiatorApproverNode({ legal: [4] }, selectNodes)).toBeNull();
    expect(compactSelectedInitiatorApprovers({ legal: [4], finance: [3] }, selectNodes)).toEqual({ legal: [4] });
  });

  it('shows resolved names and the basis for the estimate', () => {
    render(<WorkflowApprovalChain nodes={[manager]} />);
    expect(screen.getByText('张主管')).toBeInTheDocument();
    expect(screen.getByText('预计经过')).toBeInTheDocument();
    expect(screen.getByText('按发起人所在部门解析主管')).toBeInTheDocument();
  });
});
