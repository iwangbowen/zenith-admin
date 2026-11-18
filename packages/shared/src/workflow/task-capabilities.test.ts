import { describe, expect, it } from 'vitest';
import { isWorkflowBaseApprovalTask, workflowApprovalRequirements } from './task-capabilities';

describe('workflow task capabilities', () => {
  it('keeps opinion-required tasks batchable but not quick approvable', () => {
    expect(workflowApprovalRequirements({ operations: ['opinionRequired'] })).toMatchObject({ canQuickApprove: false, canBatchApprove: true });
    expect(workflowApprovalRequirements({ signaturePolicy: 'handwritten' })).toMatchObject({ canQuickApprove: false, canBatchApprove: false });
  });
  it('does not allow a suggestion or supplemental seat to create nested sign groups', () => {
    const slot = { id: 2, origin: 'base', currentTaskId: 5, status: 'pending' };
    expect(isWorkflowBaseApprovalTask({ taskKind: 'approval', slotId: 2 }, slot, 5)).toBe(true);
    expect(isWorkflowBaseApprovalTask({ taskKind: 'suggestion', slotId: 2 }, slot, 5)).toBe(false);
    expect(isWorkflowBaseApprovalTask({ taskKind: 'approval', slotId: 2 }, { ...slot, origin: 'addSign' }, 5)).toBe(false);
    expect(isWorkflowBaseApprovalTask({ taskKind: 'approval', slotId: 2 }, slot, 6)).toBe(false);
  });
});
