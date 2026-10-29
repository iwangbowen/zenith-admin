import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../../db/types';
import { workflowInstances, workflowTasks } from '../../../db/schema';

type Instance = typeof workflowInstances.$inferSelect;
type Task = typeof workflowTasks.$inferSelect;
type Outcome = { instance: Instance; task: Task; events: string[]; compensations: number; reportResults: string[] };
const harness = vi.hoisted(() => ({
  active: undefined as Outcome | undefined,
  failAt: '',
  transaction: (_fn: (tx: DbTransaction) => Promise<unknown>): Promise<unknown> => Promise.resolve(),
}));
vi.mock('../../../db', () => ({ db: {} }));
vi.mock('../../../lib/workflow-jobs/lease', () => ({ workflowTransaction: (fn: (tx: DbTransaction) => Promise<unknown>) => harness.transaction(fn) }));
vi.mock('../../../lib/workflow-jobs/engine', () => ({ enqueueJob: vi.fn() }));
vi.mock('./approval-state', () => ({ createStandaloneActivation: vi.fn() }));
vi.mock('./async-jobs', () => ({ enqueueSubprocessJoin: vi.fn() }));
vi.mock('../workflow-assignee-resolver.service', () => ({ buildStarterContext: async () => ({}), resolveAdminUserId: async () => 1 }));
vi.mock('../workflow-compensations.service', () => ({
  recordCompensation: async () => { harness.active!.compensations++; return 1; }, addCompensationLog: vi.fn(),
}));
vi.mock('../../../lib/context', () => ({ currentUser: () => ({ userId: 1, username: '申请人' }) }));
vi.mock('../../report/report-fill-workflow-bridge.service', () => ({
  bridgeReportFillWorkflowOutcome: async (_tx: unknown, input: { outcome: string }) => { harness.active!.reportResults.push(input.outcome); },
}));
vi.mock('./mapping', () => ({ mapInstance: (row: unknown) => row, mapTask: (row: unknown) => row, findExceptionCatchNode: () => null }));
vi.mock('./materialize', () => ({ advanceAndMaterialize: vi.fn(), killInstanceTokens: vi.fn(), loadLiveTokens: async () => [] }));
vi.mock('./shared', () => {
  const emit = async (type: string) => {
    if (!harness.active) throw new Error('event outside business transaction');
    if (harness.failAt === type) throw new Error('event persistence unavailable');
    harness.active.events.push(type);
  };
  return { emitTaskEvent: emit, emitNodeEvent: emit, emitInstanceEvent: emit, emitTasksEnteredEvents: vi.fn() };
});

import { handleNodeExecutionError } from './failure-policy';

let committed: Outcome;
beforeEach(() => {
  committed = {
    instance: { id: 10, definitionId: 3, initiatorId: 1, status: 'running', tenantId: 7,
      definitionSnapshot: { flowData: { nodes: [{ data: { key: 'approve', label: '审批', type: 'approve', failurePolicy: { action: 'terminate' } } }], edges: [] } },
    } as unknown as Instance,
    task: { id: 20, instanceId: 10, status: 'pending', nodeKey: 'approve', nodeType: 'approve' } as Task,
    events: [], compensations: 0, reportResults: [],
  };
  harness.failAt = ''; harness.active = undefined;
  harness.transaction = async (fn) => {
    const draft = structuredClone(committed);
    const query = { where: () => query, for: () => query, limit: async () => [draft.instance] };
    const tx = {
      select: () => ({ from: () => query }),
      update: (table: unknown) => ({ set: (patch: Record<string, unknown>) => ({ where: () => {
        const row = table === workflowInstances ? draft.instance : draft.task;
        Object.assign(row, patch);
        const result = [structuredClone(row)];
        return { returning: async () => result, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
      } }) }),
    } as unknown as DbTransaction;
    harness.active = draft;
    try { const result = await fn(tx); committed = draft; return result; }
    finally { harness.active = undefined; }
  };
});

describe('workflow failure-policy event atomicity', () => {
  const execute = () => handleNodeExecutionError({ instance: committed.instance, task: committed.task,
    nodeKey: 'approve', nodeName: '审批', errorMessage: '处理失败', actor: { userId: 1 } });

  it('persists rejected state, report bridge, compensation and ordered events before committing', async () => {
    expect(await execute()).toBe(true);
    expect(committed.instance.status).toBe('rejected');
    expect(committed.reportResults).toEqual(['rejected']);
    expect(committed.compensations).toBe(1);
    expect(committed.events).toEqual(['task.rejected', 'node.left', 'instance.rejected']);
  });

  it('a terminal event failure rolls back the business state and every prior effect', async () => {
    harness.failAt = 'instance.rejected';
    await expect(execute()).rejects.toThrow('event persistence unavailable');
    expect(committed.instance.status).toBe('running');
    expect(committed.task.status).toBe('pending');
    expect(committed.events).toEqual([]);
    expect(committed.reportResults).toEqual([]);
    expect(committed.compensations).toBe(0);
    harness.failAt = '';
    expect(await execute()).toBe(true);
    expect(committed.events).toEqual(['task.rejected', 'node.left', 'instance.rejected']);
  });
});
