import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowJobContext, WorkflowJobHandler } from '../types';

const model = vi.hoisted(() => ({ handler: undefined as WorkflowJobHandler | undefined, instanceStatus: 'returned', selectNo: 0, post: vi.fn() }));
vi.mock('../registry', () => ({ registerJobHandler: (_type: string, handler: WorkflowJobHandler) => { model.handler = handler; } }));
vi.mock('../../../db', () => ({ db: { select: vi.fn(() => {
  const call = model.selectNo++;
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn(async () => call % 2 === 0
    ? [{ status: model.instanceStatus }] : [{ activationId: 'a1' }]) };
}) } }));
vi.mock('../../workflow-outbound', () => ({ workflowHttpGet: vi.fn(), workflowHttpPost: model.post }));
vi.mock('../../encryption', () => ({ decryptField: vi.fn() }));
vi.mock('../external-effects', () => ({ throwIfWorkflowExternalEffectUncertain: vi.fn() }));

await import('./node-listener-delivery');

function context(type: 'task.rejected' | 'task.approved'): WorkflowJobContext {
  return { payload: { event: { eventId: 'e1', type, occurredAt: '2026-11-02 10:00:00', instanceId: 1, definitionId: 2,
    task: { id: 3, activationId: 'a1', nodeKey: 'approve', nodeName: '审批', status: type === 'task.rejected' ? 'rejected' : 'approved' } },
    listener: { url: 'https://example.test/hook', method: 'POST', headersEncrypted: null }, listenerEvent: type === 'task.rejected' ? 'onReject' : 'onApprove' },
  } as unknown as WorkflowJobContext;
}

beforeEach(() => { vi.clearAllMocks(); model.instanceStatus = 'returned'; model.selectNo = 0; model.post.mockResolvedValue(new Response('', { status: 200 })); });

describe('node listener terminal-state guard', () => {
  it('delivers the rejection that caused a return to initiator', async () => {
    await expect(model.handler!(context('task.rejected'))).resolves.toMatchObject({ responseStatus: 200 });
    expect(model.post).toHaveBeenCalledTimes(1);
  });

  it('still skips unrelated callbacks after the instance is returned', async () => {
    await expect(model.handler!(context('task.approved'))).rejects.toThrow('no longer applicable');
    expect(model.post).not.toHaveBeenCalled();
  });
});
