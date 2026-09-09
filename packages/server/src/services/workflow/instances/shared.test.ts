/**
 * emitTasksEnteredEvents：推进产生的新任务统一补发 node.entered / task.created / 状态分支事件。
 * 锁住事件顺序与分支条件，并区分「事务内 outbox（await emitInTx）」与「提交后同步 emit」两条路径。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { workflowTasks } from '../../../db/schema';
import type { DbExecutor } from '../../../db/types';

const { emit, emitInTx } = vi.hoisted(() => ({ emit: vi.fn(), emitInTx: vi.fn(async () => ({})) }));
vi.mock('../../../lib/workflow-event-bus', () => ({ workflowEventBus: { emit, emitInTx } }));
vi.mock('../../../lib/context', () => ({ currentUserOrNull: () => null, currentUserDetail: async () => null }));

import { emitTasksEnteredEvents } from './shared';

type TaskRow = typeof workflowTasks.$inferSelect;

function task(over: Partial<TaskRow>): TaskRow {
  return {
    id: 1, instanceId: 10, nodeKey: 'approve1', nodeName: '审批', nodeType: 'approve', assigneeId: 7, status: 'pending',
    comment: null, signature: null, attachments: [], actionAt: null, originalAssigneeId: null, delegatedFromId: null, delegationMode: null,
    signType: null, approveMethod: null, approveRatio: null, externalCallbackId: null, createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as TaskRow;
}

const meta = { definitionId: 3, tenantId: null, actor: { userId: 9, name: 'op' } };
const typesOf = (calls: unknown[][]) => calls.map(([ev]) => (ev as { type: string }).type);

beforeEach(() => { emit.mockClear(); emitInTx.mockClear(); });

describe('emitTasksEnteredEvents', () => {
  it('待办任务：node.entered → task.created → task.assigned，按任务顺序同步发射', () => {
    const result = emitTasksEnteredEvents(10, [task({ id: 1, nodeKey: 'a' }), task({ id: 2, nodeKey: 'b' })], meta);
    expect(result).toBeUndefined();
    expect(typesOf(emit.mock.calls)).toEqual([
      'node.entered', 'task.created', 'task.assigned',
      'node.entered', 'task.created', 'task.assigned',
    ]);
    expect(emit.mock.calls[0][0]).toMatchObject({ instanceId: 10, definitionId: 3, nodeKey: 'a', nodeName: '审批', nodeType: 'approve', actor: meta.actor });
    expect(emit.mock.calls[1][0]).toMatchObject({ type: 'task.created', task: { id: 1, nodeKey: 'a' } });
    expect(emitInTx).not.toHaveBeenCalled();
  });

  it('自动通过 / 驳回的任务补发对应终态事件，无处理人或非 pending 不发 assigned', () => {
    emitTasksEnteredEvents(10, [
      task({ id: 1, status: 'approved' }),
      task({ id: 2, status: 'rejected', assigneeId: null }),
      task({ id: 3, status: 'pending', assigneeId: null }),
    ], meta);
    expect(typesOf(emit.mock.calls)).toEqual([
      'node.entered', 'task.created', 'task.approved',
      'node.entered', 'task.created', 'task.rejected',
      'node.entered', 'task.created',
    ]);
  });

  it('传 executor 时全部经 emitInTx 入队 outbox，返回可 await 的 Promise', async () => {
    const executor = {} as DbExecutor;
    const result = emitTasksEnteredEvents(10, [task({ id: 1 })], meta, executor);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(emit).not.toHaveBeenCalled();
    expect(typesOf(emitInTx.mock.calls)).toEqual(['node.entered', 'task.created', 'task.assigned']);
    expect(emitInTx.mock.calls.every(([, ex]) => ex === executor)).toBe(true);
  });

  it('空任务列表不发任何事件', () => {
    emitTasksEnteredEvents(10, [], meta);
    expect(emit).not.toHaveBeenCalled();
  });
});
