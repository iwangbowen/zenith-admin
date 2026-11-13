import { render } from '@testing-library/react';
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
  it('excludes unmatched branches from required approver selections', () => {
    const onNodesChange = vi.fn();
    render(<WorkflowApprovalChain nodes={[manager, excluded]} selectable onNodesChange={onNodesChange} />);

    expect(onNodesChange).toHaveBeenLastCalledWith([]);
    expect(compactSelectedInitiatorApprovers({ finance: [3] }, onNodesChange.mock.lastCall![0])).toBeUndefined();
  });

  it('requires potential approvers for uncertain branches before launch', () => {
    const onNodesChange = vi.fn();
    render(<WorkflowApprovalChain nodes={[unknown]} selectable highlightMissing onNodesChange={onNodesChange} />);

    const selectNodes = onNodesChange.mock.lastCall![0];
    expect(firstMissingInitiatorApproverNode({}, selectNodes)?.nodeKey).toBe('legal');
    expect(firstMissingInitiatorApproverNode({ legal: [4] }, selectNodes)).toBeNull();
    expect(compactSelectedInitiatorApprovers({ legal: [4], finance: [3] }, selectNodes)).toEqual({ legal: [4] });
  });
});
