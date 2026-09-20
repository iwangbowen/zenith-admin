import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowFlowData } from '@zenith/shared/workflow';

const state = vi.hoisted(() => ({ monitor: false, mask: vi.fn() }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 9 }), hasPermission: async () => state.monitor }));
vi.mock('../../lib/data-mask/policies', () => ({ resolveMaskDecisions: state.mask }));
vi.mock('../../lib/data-mask/registry', () => ({ registerSensitiveSource: vi.fn() }));
import { workflowArchiveNeedsRedaction } from './workflow-print-access';
import { hiddenWorkflowFieldKeys, sanitizeDetailFormDataForViewer } from './workflow-form-access';

function row() {
  return { initiatorId: 9, tasks: [], formSnapshot: { fields: [{ key: 'secret', type: 'input', label: 'Sensitive field' }] },
    definitionSnapshot: { flowData: { nodes: [{ data: { key: 'start', type: 'start', fieldPermissions: { secret: 'hidden', public: 'read' } } }], edges: [] } as unknown as WorkflowFlowData } };
}
beforeEach(() => { state.monitor = false; state.mask.mockReset().mockResolvedValue([]); });
describe('archive originals enforce the same field visibility as workflow detail', () => {
  it('blocks an original containing a hidden field even when no PII masking applies', async () => {
    expect(await workflowArchiveNeedsRedaction(row())).toBe(true);
    expect(state.mask).not.toHaveBeenCalled();
    expect(sanitizeDetailFormDataForViewer({ ...row(), formData: { secret: 'private', public: 'visible' } }, 9)).toEqual({ public: 'visible' });
  });
  it('allows a monitor after the separate PII decision grants access', async () => {
    state.monitor = true;
    expect(await workflowArchiveNeedsRedaction(row())).toBe(false);
  });
  it('keeps the union of visible fields across a viewer’s approval nodes', () => {
    const value = row();
    const definitionSnapshot = { flowData: { nodes: [
      ...value.definitionSnapshot.flowData.nodes,
      { data: { key: 'approve', type: 'approve', fieldPermissions: { secret: 'read' } } },
    ], edges: [] } as unknown as WorkflowFlowData };
    expect(hiddenWorkflowFieldKeys({ ...value, definitionSnapshot, tasks: [{ assigneeId: 9, nodeKey: 'approve' }] }, 9).size).toBe(0);
  });
  it('blocks PII originals and carries the supplied transaction into policy reads', async () => {
    state.monitor = true;
    state.mask.mockResolvedValue([{ ref: { field: 'phone' } }]);
    const value = { ...row(), formSnapshot: { fields: [{ key: 'phone', type: 'phone', label: 'Phone' }] } };
    const executor = {} as Parameters<typeof workflowArchiveNeedsRedaction>[1];
    expect(await workflowArchiveNeedsRedaction(value, executor)).toBe(true);
    expect(state.mask.mock.calls[0][1]).toBe(executor);
  });
  it('does not block absent PII categories when unrelated policies apply', async () => {
    state.monitor = true;
    state.mask.mockResolvedValue([{ ref: { field: 'email' } }]);
    expect(await workflowArchiveNeedsRedaction({ ...row(), formSnapshot: { fields: [{ key: 'phone', type: 'phone', label: 'Phone' }] } })).toBe(false);
  });
});
