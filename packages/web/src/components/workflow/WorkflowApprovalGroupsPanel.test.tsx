import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeActivation } from '@zenith/shared/workflow';
import { WorkflowApprovalGroupsPanel } from './WorkflowApprovalGroupsPanel';

const mutation = vi.hoisted(() => ({ reduce: vi.fn().mockResolvedValue({ instance: { id: 9 } }) }));
vi.mock('@/hooks/queries/workflow-tasks', () => ({ useReduceWorkflowSignGroup: () => ({ mutateAsync: mutation.reduce, isPending: false }) }));

const base = { id: 11, activationId: 'round-one', origin: 'base' as const, groupId: null, originalAssigneeId: 1,
  currentAssigneeId: 1, assigneeName: '张主管', status: 'approved' as const, order: null, mandatory: true, currentTaskId: 101 };
const added = { id: 12, activationId: 'round-one', origin: 'addSign' as const, groupId: 20, originalAssigneeId: 2,
  currentAssigneeId: 2, assigneeName: '赵法务', status: 'pending' as const, order: null, mandatory: false, currentTaskId: 102 };
const activation: WorkflowNodeActivation = { id: 'round-one', nodeKey: 'review', nodeName: '合同审核', tokenId: 1,
  status: 'active', approveMethod: 'or', approveRatio: null, baseTotal: 1, baseRequired: 1, baseApproved: 1, baseRejected: 0,
  baseSatisfied: true, slots: [base, added], signGroups: [{ id: 20, activationId: 'round-one', anchorSlotId: 11,
    position: 'after', signMode: 'and', status: 'active', createdBy: 1, createdAt: '2026-10-02 08:00:00', canReduce: true, slots: [added] }],
};

describe('supplemental approval group controls', () => {
  it('allows the group owner to reduce after the original task has already been approved', async () => {
    render(<WorkflowApprovalGroupsPanel activations={[activation]} />);
    expect(screen.getByText('基础意见 1/1，需 1 票')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '减签' }));
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: '赵法务' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'confirm' })); });
    await waitFor(() => expect(mutation.reduce).toHaveBeenCalledWith(expect.objectContaining({
      params: { groupId: 20 }, body: expect.objectContaining({ targetSlotIds: [12] }),
    })));
  });

  it('keeps business read-only contexts free of mutation entry points', () => {
    render(<WorkflowApprovalGroupsPanel activations={[activation]} allowActions={false} />);
    expect(screen.getByText('后加签')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '减签' })).not.toBeInTheDocument();
  });
});
