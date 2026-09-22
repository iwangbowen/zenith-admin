import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { asyncTasks, type AsyncTaskRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';

const state = vi.hoisted(() => ({ transaction: vi.fn(), event: vi.fn() }));
vi.mock('../../db', () => ({ db: { transaction: state.transaction } }));
vi.mock('../../services/platform/relations/events.service', () => ({ recordDomainEvent: state.event }));
import { completeAsyncTasks } from './terminal-events';

const at = new Date('2026-09-22T01:02:03Z');
const task = { id: 41, taskType: 'safe-export', status: 'failed', attempts: 2, completedAt: at, tenantId: 7, traceId: 'trace', parentRef: 'request' } as AsyncTaskRow;

function install(rows: AsyncTaskRow[], subjects = [{ type: 'payment.order', key: '9', role: 'related' as const }]) {
  const committed: AsyncTaskRow[] = [];
  const tx = {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => rows }) }) }),
    select: () => ({ from: () => ({ where: async () => subjects }) }),
  } as unknown as DbTransaction;
  state.transaction.mockImplementation(async (work) => {
    const result = await work(tx);
    committed.push(...rows);
    return result;
  });
  return { tx, committed };
}

beforeEach(() => { vi.resetAllMocks(); state.event.mockResolvedValue(1); });
describe('task terminal business events', () => {
  it('commits the terminal fact with the same transaction and exact trusted subjects', async () => {
    const f = install([task]);
    await expect(completeAsyncTasks({ status: 'failed', completedAt: at }, eq(asyncTasks.id, task.id))).resolves.toEqual([task]);
    expect(state.event).toHaveBeenCalledWith(f.tx, expect.objectContaining({
      eventType: 'tasks.async-task.failed', tenantId: 7, source: { type: 'tasks.async', key: '41' },
      payload: { taskType: 'safe-export', status: 'failed', attempt: 2 },
      subjects: [{ type: 'payment.order', key: '9', role: 'related' }],
    }));
    expect(f.committed).toEqual([task]);
  });
  it('cannot commit a terminal state if recording its event fails', async () => {
    const f = install([task]);
    state.event.mockRejectedValue(new Error('event unavailable'));
    await expect(completeAsyncTasks({ status: 'failed', completedAt: at }, eq(asyncTasks.id, task.id))).rejects.toThrow('event unavailable');
    expect(f.committed).toEqual([]);
  });
  it('emits no duplicate event when the conditional terminal transition loses a race', async () => {
    install([]);
    await completeAsyncTasks({ status: 'cancelled', completedAt: at }, eq(asyncTasks.id, task.id));
    expect(state.event).not.toHaveBeenCalled();
  });
  it('distinguishes a restarted run even if its attempt counter was reset', async () => {
    install([task]);
    await completeAsyncTasks({ status: 'failed', completedAt: at }, eq(asyncTasks.id, task.id));
    const first = state.event.mock.calls[0][1].dedupeKey;
    const later = new Date(at.getTime() + 1000);
    install([{ ...task, completedAt: later }]);
    await completeAsyncTasks({ status: 'failed', completedAt: later }, eq(asyncTasks.id, task.id));
    expect(state.event.mock.calls[1][1].dedupeKey).not.toBe(first);
  });
});
