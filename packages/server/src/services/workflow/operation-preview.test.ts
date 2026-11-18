import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: { userId: 1, tenantId: 7, viewingTenantId: undefined as number | undefined } }));
vi.mock('../../lib/context', () => ({ currentUser: () => state.user }));
import { assertWorkflowPreview, issueWorkflowPreview } from './operation-preview';
afterEach(() => { vi.useRealTimers(); state.user.userId = 1; });
describe('workflow action preview binding', () => {
  it('binds the exact action, scope, filter, object versions and expiration', () => {
    const objects = [{ id: 1, generation: 3, status: 'dead' }];
    const proof = issueWorkflowPreview('replay', { status: 'dead' }, objects);
    expect(() => assertWorkflowPreview(proof, 'replay', { status: 'dead' }, objects)).not.toThrow();
    expect(() => assertWorkflowPreview(proof, 'skip', { status: 'dead' }, objects)).toThrow('预检');
    expect(() => assertWorkflowPreview(proof, 'replay', { status: 'dead' }, [{ ...objects[0], generation: 4 }])).toThrow('预检');
    state.user.userId = 2;
    expect(() => assertWorkflowPreview(proof, 'replay', { status: 'dead' }, objects)).toThrow('预检');
    state.user.userId = 1;
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(() => assertWorkflowPreview(proof, 'replay', { status: 'dead' }, objects)).toThrow('预检');
  });
});
