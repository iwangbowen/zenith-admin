import { createRef, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '@zenith/shared/workflow';
import WorkflowLaunchForm, { type WorkflowLaunchFormHandle } from './WorkflowLaunchForm';

const dynamic = vi.hoisted(() => ({ validate: vi.fn(), getValues: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, nickname: '申请人' } }) }));
vi.mock('@/hooks/queries/workflow-shared', () => ({ useWorkflowUserOptions: () => ({ userOptions: [{ value: 3, label: '财务' }] }) }));
vi.mock('@/components/workflow/WorkflowProcessLayout', () => ({ default: ({ left, chain }: { left: ReactNode; chain: ReactNode }) => <>{left}{chain}</> }));
vi.mock('@/components/workflow/WorkflowGraphView', () => ({ default: () => null }));
vi.mock('@/pages/workflow/designer/components/WorkflowFormRenderer', () => ({
  default: ({ getFormApi }: { getFormApi: (api: unknown) => void }) => { getFormApi(dynamic); return null; },
}));
vi.mock('@/components/workflow/WorkflowApprovalChainPanel', () => ({
  default: ({ value }: { value: unknown }) => <output data-testid="selected-approvers">{JSON.stringify(value)}</output>,
  compactSelectedInitiatorApprovers: (value: unknown) => value,
  firstMissingInitiatorApproverNode: () => null,
}));

const def = { id: 42, name: '设备采购', formType: 'designer', formFields: [{ key: 'reason', type: 'textarea', label: '事由', required: true }] } as WorkflowDefinition;

describe('non-validating launch snapshot', () => {
  it('captures incomplete fields without validating and restores the complete launch header and selections', async () => {
    const values = { reason: '', attachments: [{ id: 9, name: '报价.pdf' }] };
    dynamic.getValues.mockReturnValue(values);
    dynamic.validate.mockRejectedValue(new Error('请填写事由'));
    const ref = createRef<WorkflowLaunchFormHandle>();
    render(<WorkflowLaunchForm ref={ref} def={def} container="tab" initialTitle="" initialPriority="urgent" initialCcUserIds={[3]}
      initialFormData={values} initialSelectedInitiatorApprovers={{ manager: [6] }} initialDirty />);
    await waitFor(() => expect(screen.getByTestId('selected-approvers')).toHaveTextContent('manager'));
    expect(ref.current?.getSnapshot()).toMatchObject({ definitionId: 42, dirty: true,
      values: { title: '', priority: 'urgent', ccUserIds: [3] }, formData: values, selectedInitiatorApprovers: { manager: [6] },
    });
    expect(dynamic.validate).not.toHaveBeenCalled();
  });

  it('does not flag the automatic title or derived initialization as an unsaved edit', async () => {
    dynamic.getValues.mockReturnValue({ reason: undefined });
    const ref = createRef<WorkflowLaunchFormHandle>();
    render(<WorkflowLaunchForm ref={ref} def={def} container="sheet" />);
    await waitFor(() => expect((screen.getByPlaceholderText('自动生成，可手动修改') as HTMLInputElement).value).toContain('设备采购 - 申请人'));
    expect(ref.current?.hasUnsavedChanges()).toBe(false);
  });
});
