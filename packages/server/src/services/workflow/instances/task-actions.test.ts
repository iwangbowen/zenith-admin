import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { WORKFLOW_ADVANCING_JOB_TYPES } from '@zenith/shared/workflow';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import type { DbExecutor } from '../../../db/types';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), dbSelect: vi.fn(), killTokens: vi.fn(), cancelJobs: vi.fn(),
  advance: vi.fn(), checkCompletion: vi.fn(), bridge: vi.fn(),
  emitTask: vi.fn(), emitNode: vi.fn(), emitInstance: vi.fn(), emitEntered: vi.fn(), lock: vi.fn(),
}));
vi.mock('../../../db', () => ({ db: { select: mocks.dbSelect } }));
vi.mock('../../../lib/workflow-jobs/lease', () => ({ workflowTransaction: mocks.transaction }));
vi.mock('../../../lib/workflow-jobs/engine', async () => ({
  WORKFLOW_ADVANCING_JOB_TYPES: (await import('@zenith/shared/workflow')).WORKFLOW_ADVANCING_JOB_TYPES,
  cancelJobs: mocks.cancelJobs,
}));
vi.mock('../workflow-attachments.service', () => ({
  bindWorkflowAttachments: async () => [],
  bindWorkflowFormAttachments: async (_tx: unknown, _inst: unknown, _snapshot: unknown, data: unknown) => data,
}));
vi.mock('../../payment/payment-recon-adjustment-policy', () => ({ assertIndependentReconApproval: vi.fn() }));
vi.mock('./signature-concurrency', () => ({ assertWorkflowFormUpdatesCurrent: vi.fn() }));
vi.mock('./signatures', () => ({ resolveWorkflowFormSignatures: vi.fn(), resolveWorkflowTaskSignature: vi.fn(), signatureTaskValues: () => ({}) }));
vi.mock('../../../lib/context', () => ({ currentUser: () => ({ userId: 7, username: 'reviewer' }) }));
vi.mock('../workflow-assignee-resolver.service', () => ({ buildStarterContext: async () => ({}), searchSelectableApprovers: vi.fn() }));
vi.mock('../../../lib/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('./async-jobs', () => ({ enqueueSubprocessJoin: vi.fn() }));
vi.mock('./initiator-select', () => ({ assertSelectedNextApprovers: vi.fn() }));
vi.mock('./mapping', () => ({ mapInstance: (row: unknown) => row, mapTask: (row: unknown) => row }));
vi.mock('./materialize', () => ({
  advanceAndMaterialize: mocks.advance,
  checkNodeCompletion: mocks.checkCompletion,
  filterCurrentActivation: <T>(rows: T[]) => rows,
  killInstanceTokens: mocks.killTokens,
}));
vi.mock('./shared', () => ({
  emitInstanceEvent: mocks.emitInstance, emitNodeEvent: mocks.emitNode, emitTaskEvent: mocks.emitTask,
  emitTasksEnteredEvents: mocks.emitEntered, lockInstanceExpecting: mocks.lock, requireCallbackTaskContext: vi.fn(),
}));
vi.mock('./transfers', () => ({ hasUserHandledTask: vi.fn() }));
vi.mock('../../report/report-fill-workflow-bridge.service', () => ({ bridgeReportFillWorkflowOutcome: mocks.bridge }));
vi.mock('../../report/report-fill-task.service', () => ({ submitReportFillSyncForWorkflowInstance: vi.fn() }));

import { approveTaskCore, rejectTaskCore } from './task-actions';

type TaskRow = typeof workflowTasks.$inferSelect;
type InstanceRow = typeof workflowInstances.$inferSelect;
type Row = Record<string, unknown>;
const actor = { userId: 7, name: '审批人' };
const dialect = new PgDialect({ casing: 'snake_case' });

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 1, instanceId: 10, nodeKey: 'finance', nodeName: '财务审批', nodeType: 'approve',
    assigneeId: 7, status: 'pending', approveMethod: 'and', approveRatio: null,
    activationId: 'round-1', signType: null, decision: null, comment: null,
    attachments: [], actionAt: null, ...overrides,
  } as TaskRow;
}

function instance(strategy: 'terminate' | 'returnStart' | 'returnToNode' = 'terminate', target?: { key: string; type: 'approve' | 'handler' | 'end' }): InstanceRow {
  return {
    id: 10, definitionId: 3, status: 'running', currentNodeKey: 'finance',
    initiatorId: 5, tenantId: null, parentTaskId: null, bizType: null, formData: {},
    definitionSnapshot: {
      flowData: {
        nodes: [
          { id: 'finance', data: { key: 'finance', label: '财务审批', type: 'approve', rejectStrategy: strategy, rejectToNodeKey: target?.key ?? 'missing' } },
          ...(target ? [{ id: target.key, data: { ...target, label: '退回目标' } }] : []),
        ], edges: [], settings: {},
      },
    },
  } as InstanceRow;
}

/** Apply the simple equality / status-list predicates used by these actions to detached test rows. */
function matches(row: Row, condition: SQL): boolean {
  const query = dialect.sqlToQuery(condition);
  const predicates = new Map<string, unknown[]>();
  for (const match of query.sql.matchAll(/"\w+"\."(\w+)"\s*(?:=\s*(\$\d+)|in\s*\(([^)]+)\))/g)) {
    const key = match[1].replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase());
    const placeholders = (match[2] ?? match[3]).match(/\$\d+/g) ?? [];
    predicates.set(key, [...(predicates.get(key) ?? []), ...placeholders.map((p) => query.params[Number(p.slice(1)) - 1])]);
  }
  if (!predicates.size) throw new Error(`Unsupported test predicate: ${query.sql}`);
  return [...predicates].every(([key, values]) => values.includes(row[key]));
}

function executor(inst: InstanceRow, tasks: TaskRow[]) {
  const rowsFor = (table: unknown) => table === workflowTasks ? tasks : table === workflowInstances ? [inst] : [];
  const tx = {
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: (condition: SQL) => ({
          returning: async () => rowsFor(table).filter((row) => matches(row as unknown as Row, condition)).map((row) => {
            Object.assign(row, structuredClone(patch));
            return structuredClone(row);
          }),
        }),
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const rows = rowsFor(table).filter((row) => matches(row as unknown as Row, condition)).map((row) => structuredClone(row));
          const query = { for: () => query, limit: async () => rows, then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
          return query;
        },
      }),
    }),
  } as unknown as DbExecutor;
  mocks.transaction.mockImplementation(async (fn: (transaction: DbExecutor) => Promise<unknown>) => fn(tx));
  mocks.dbSelect.mockImplementation(tx.select.bind(tx));
  return tx;
}

function skippedIds() {
  return mocks.emitTask.mock.calls.filter(([type]) => type === 'task.skipped').map(([, row]) => row.id).sort((a, b) => a - b);
}

function expectTerminalCleanup(tx: DbExecutor, inst: InstanceRow, tasks: TaskRow[]) {
  expect(inst).toMatchObject({ status: 'rejected', currentNodeKey: null });
  expect(tasks.filter((row) => row.instanceId === inst.id && ['pending', 'waiting'].includes(row.status))).toEqual([]);
  expect(mocks.killTokens).toHaveBeenCalledWith(tx, inst.id);
  expect(mocks.cancelJobs).toHaveBeenCalledWith({ instanceId: inst.id, jobTypes: WORKFLOW_ADVANCING_JOB_TYPES }, tx);
  expect(mocks.emitTask.mock.calls.every(([, , , executor]) => executor === tx)).toBe(true);
  expect(mocks.emitInstance).toHaveBeenCalledWith('instance.rejected', expect.objectContaining({ id: inst.id, status: 'rejected' }), actor, tx);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bridge.mockResolvedValue({ changed: false, approved: false });
  mocks.cancelJobs.mockResolvedValue(0);
  mocks.checkCompletion.mockResolvedValue({ completed: true });
  mocks.advance.mockResolvedValue({ createdTasks: [], rejected: false, finished: false, currentNodeKeys: ['target'] });
});

describe('rejectTaskCore terminal cleanup', () => {
  it('clears every parallel pending / external waiting task, preserves completed history and isolates other instances', async () => {
    const inst = instance();
    const tasks = [
      task(), task({ id: 2, assigneeId: 8 }),
      task({ id: 3, nodeKey: 'budget', assigneeId: 9 }),
      task({ id: 4, nodeKey: 'external', status: 'waiting', assigneeId: null, externalCallbackId: 'callback-1' }),
      task({ id: 5, status: 'approved', comment: '已审核', actionAt: new Date() }),
      task({ id: 6, status: 'rejected', comment: '上一轮拒绝', activationId: 'round-0' }),
      task({ id: 7, instanceId: 11 }),
    ];
    const history = structuredClone(tasks.slice(4));
    const tx = executor(inst, tasks);
    await rejectTaskCore(structuredClone(tasks[0]), structuredClone(inst), '凭证有误', actor);
    expectTerminalCleanup(tx, inst, tasks);
    expect(tasks[0]).toMatchObject({ status: 'rejected', comment: '凭证有误', decision: { action: 'reject' } });
    expect(skippedIds()).toEqual([2, 3, 4]);
    expect(tasks[2].comment).toContain('流程已被驳回终止');
    expect(tasks[3].actionAt).toBeInstanceOf(Date);
    expect(tasks.slice(4)).toEqual(history);
  });

  it.each([undefined, { key: 'end', type: 'end' as const }])('clears parallel tasks when the configured return target cannot receive approval: %s', async (target) => {
    const inst = instance('returnToNode', target);
    const tasks = [task(), task({ id: 2, nodeKey: 'budget' })];
    const tx = executor(inst, tasks);
    await rejectTaskCore(structuredClone(tasks[0]), structuredClone(inst), '退回', actor);
    expectTerminalCleanup(tx, inst, tasks);
    expect(tasks[0].decision?.action).toBe('reject');
    expect(skippedIds()).toEqual([2]);
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it('keeps a ratio node and its parallel branch active while its approval threshold is still reachable', async () => {
    const inst = instance('returnStart');
    const tasks = [
      task({ approveMethod: 'ratio', approveRatio: 51 }),
      task({ id: 2, assigneeId: 8, approveMethod: 'ratio', approveRatio: 51 }),
      task({ id: 3, assigneeId: 9, approveMethod: 'ratio', approveRatio: 51 }),
      task({ id: 4, nodeKey: 'budget', status: 'waiting' }),
    ];
    executor(inst, tasks);
    await rejectTaskCore(structuredClone(tasks[0]), structuredClone(inst), '拒绝意见', actor);
    expect(inst.status).toBe('running');
    expect(tasks.map((row) => row.status)).toEqual(['rejected', 'pending', 'pending', 'waiting']);
    expect(tasks[0].decision?.action).toBe('reject');
    expect(mocks.killTokens).not.toHaveBeenCalled();
    expect(mocks.cancelJobs).not.toHaveBeenCalled();
    expect(mocks.emitTask.mock.calls.map(([type]) => type)).toEqual(['task.rejected']);
    expect(mocks.emitNode).not.toHaveBeenCalled();
    expect(mocks.emitInstance).not.toHaveBeenCalled();
  });

  it('terminates and clears all branches when ratio approval can no longer reach the threshold', async () => {
    const inst = instance();
    const tasks = [
      task({ approveMethod: 'ratio', approveRatio: 75 }),
      task({ id: 2, status: 'rejected', approveMethod: 'ratio', approveRatio: 75 }),
      task({ id: 3, approveMethod: 'ratio', approveRatio: 75 }),
      task({ id: 4, nodeKey: 'budget', status: 'waiting' }),
    ];
    const tx = executor(inst, tasks);
    await rejectTaskCore(structuredClone(tasks[0]), structuredClone(inst), '拒绝意见', actor);
    expectTerminalCleanup(tx, inst, tasks);
    expect(skippedIds()).toEqual([3, 4]);
  });

  it('records return to initiator as an actual action and keeps the instance available for resubmission', async () => {
    const inst = instance('returnStart');
    const tasks = [task(), task({ id: 2, nodeKey: 'budget' })];
    const tx = executor(inst, tasks);
    await rejectTaskCore(structuredClone(tasks[0]), structuredClone(inst), '补齐资料', actor);
    expect(inst.status).toBe('returned');
    expect(tasks[0].decision).toEqual({ action: 'returnInitiator', targetNodeKey: null, targetNodeName: null });
    expect(skippedIds()).toEqual([2]);
    expect(mocks.emitInstance).toHaveBeenCalledWith('instance.returned', expect.objectContaining({ id: 10 }), actor, tx);
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it('records the actual target for a valid node return', async () => {
    const inst = instance('returnToNode', { key: 'manager', type: 'approve' });
    const tasks = [task()];
    executor(inst, tasks);
    await rejectTaskCore(structuredClone(tasks[0]), structuredClone(inst), '重新审核', actor);
    expect(inst.status).toBe('running');
    expect(tasks[0].decision).toEqual({ action: 'returnNode', targetNodeKey: 'manager', targetNodeName: '退回目标' });
    expect(mocks.advance).toHaveBeenCalledWith({ kind: 'enterNode', nodeKey: 'manager' }, expect.anything());
    expect(mocks.emitInstance).not.toHaveBeenCalled();
  });
});

describe('automatic rejection after approval / return', () => {
  it.each(['approve', 'return'] as const)('emits skipped events for old parallel tasks and entered events for the automatic rejection after %s', async (action) => {
    const inst = action === 'approve' ? instance() : instance('returnToNode', { key: 'manager', type: 'approve' });
    const tasks = [task(), task({ id: 2, nodeKey: 'budget' }), task({ id: 3, nodeKey: 'external', status: 'waiting' })];
    const automatic = task({ id: 4, nodeKey: 'emptyAssignee', status: 'rejected', assigneeId: null });
    mocks.advance.mockResolvedValue({ createdTasks: [automatic], rejected: true, finished: false, currentNodeKeys: [] });
    const tx = executor(inst, tasks);
    if (action === 'approve') await approveTaskCore(structuredClone(tasks[0]), structuredClone(inst), '同意', actor);
    else await rejectTaskCore(structuredClone(tasks[0]), structuredClone(inst), '重新审核', actor);
    expectTerminalCleanup(tx, inst, tasks);
    expect(skippedIds()).toEqual([2, 3]);
    expect(mocks.emitEntered).toHaveBeenCalledWith(inst.id, [automatic], expect.anything(), tx);
    expect(mocks.bridge).toHaveBeenCalledWith(tx, expect.objectContaining({ outcome: 'rejected' }));
  });

  it.each(['approve', 'handler'] as const)('records %s decisions on the task before a downstream automatic rejection', async (nodeType) => {
    const inst = instance();
    const tasks = [task({ nodeType })];
    mocks.advance.mockResolvedValue({ createdTasks: [], rejected: true, finished: false, currentNodeKeys: [] });
    executor(inst, tasks);
    await approveTaskCore(structuredClone(tasks[0]), structuredClone(inst), '已处理', actor);
    expect(tasks[0].decision).toEqual({ action: nodeType === 'handler' ? 'complete' : 'approve', targetNodeKey: null, targetNodeName: null });
  });
});
