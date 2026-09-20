import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../db/types';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), event: vi.fn(), transaction: vi.fn(), schedule: vi.fn() }));
vi.mock('../db', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('./workflow-jobs/engine', () => ({ enqueueJob: mocks.enqueue, scheduleJobPickup: mocks.schedule }));
vi.mock('../services/platform/relations/events.service', () => ({ recordDomainEvent: mocks.event }));
vi.mock('./context', () => ({ currentTraceId: () => 'trace-41' }));
vi.mock('./workflow-jobs/execution-context', () => ({ currentWorkflowJobContext: () => undefined, deferWorkflowJobEffect: vi.fn() }));

import { workflowEventBus } from './workflow-event-bus';

const event = {
  type: 'instance.created', eventId: 'event-41', instanceId: 41, definitionId: 2, tenantId: 7,
  instance: { status: 'pending', formData: { secret: 'must not enter timeline' } },
  actor: { userId: 9 },
} as unknown as Parameters<typeof workflowEventBus.emit>[0];

describe('workflow event persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueue.mockResolvedValue({ id: 18, runAt: new Date() });
    mocks.event.mockResolvedValue(29);
  });

  it('keeps the original transaction for dispatch and safe timeline writes', async () => {
    const tx = {} as DbTransaction;
    await workflowEventBus.emitInTx(event, tx);
    expect(mocks.enqueue.mock.calls[0][1]).toBe(tx);
    expect(mocks.event).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventType: 'workflow.instance.created', tenantId: 7,
      source: { type: 'workflow.instance', key: '41' },
      payload: { instanceId: 41, status: 'pending' },
    }));
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('propagates timeline persistence failure to the business transaction', async () => {
    mocks.event.mockRejectedValueOnce(new Error('event persistence failed'));
    await expect(workflowEventBus.emitInTx(event, {} as DbTransaction)).rejects.toThrow('event persistence failed');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('publishes nontransactional events only after both writes commit', async () => {
    const stages: string[] = [];
    const tx = {} as DbTransaction;
    mocks.enqueue.mockImplementation(async () => { stages.push('job'); return { id: 18, runAt: new Date() }; });
    mocks.event.mockImplementation(async () => { stages.push('event'); return 29; });
    mocks.transaction.mockImplementation(async (write: (executor: DbTransaction) => Promise<unknown>) => {
      const result = await write(tx);
      stages.push('commit');
      return result;
    });
    mocks.schedule.mockImplementation(() => { stages.push('publish'); });
    workflowEventBus.emit(event);
    await vi.waitFor(() => expect(stages).toEqual(['job', 'event', 'commit', 'publish']));
  });
});
