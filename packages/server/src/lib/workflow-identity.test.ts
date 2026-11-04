import { describe, expect, it, vi } from 'vitest';
import { registerWorkflowIdentity, workflowIdentity } from './workflow-identity';

describe('workflow identity capability injection', () => {
  it('requires composition and freezes a minimal port instead of importing identity services', async () => {
    expect(() => workflowIdentity()).toThrow('尚未装配');
    const loadUserDisplays = vi.fn().mockResolvedValue(new Map([[7, { name: 'reader', avatar: null }]]));
    const port = { loadUserDisplays, listSelectableUsers: vi.fn().mockResolvedValue([]), resolveSignature: vi.fn() };
    registerWorkflowIdentity(port);
    await expect(workflowIdentity().loadUserDisplays([7])).resolves.toEqual(new Map([[7, { name: 'reader', avatar: null }]]));
    expect(loadUserDisplays).toHaveBeenCalledWith([7]);
    expect(Object.isFrozen(workflowIdentity())).toBe(true);
    expect(() => registerWorkflowIdentity(port)).toThrow('冻结');
  });
});
