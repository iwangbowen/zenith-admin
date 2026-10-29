/**
 * emitTasksEnteredEvents：推进产生的新任务统一补发 node.entered / task.created / 状态分支事件。
 * 验证事件顺序、失败传播，以及审批业务回写与事件共享同一事务。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { workflowTasks } from '../../../db/schema';
import type { DbTransaction } from '../../../db/types';

const { emit, emitInTx, outcome } = vi.hoisted(() => ({ emit: vi.fn(), emitInTx: vi.fn(async () => ({})), outcome: vi.fn(async () => undefined) }));
vi.mock('../../../lib/workflow-event-bus', () => ({ workflowEventBus: { emit, emitInTx } }));
vi.mock('../../../lib/workflow-business', () => ({ getWorkflowBusinessAdapter: () => ({ onOutcomeInTransaction: outcome }) }));
vi.mock('../../../lib/context', () => ({ currentUserOrNull: () => null, currentUserDetail: async () => null }));

import { emitInstanceEvent, emitTasksEnteredEvents } from './shared';

type TaskRow = typeof workflowTasks.$inferSelect;

function task(over: Partial<TaskRow>): TaskRow {
  return {
    id: 1, instanceId: 10, nodeKey: 'approve1', nodeName: '审批', nodeType: 'approve', assigneeId: 7, status: 'pending',
    comment: null, signature: null, signatureEvidence: null, attachments: [], actionAt: null, originalAssigneeId: null, delegatedFromId: null, delegationMode: null,
    signType: null, approveMethod: null, approveRatio: null, externalCallbackId: null, createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as TaskRow;
}

const meta = { definitionId: 3, tenantId: null, actor: { userId: 9, name: 'op' } };
const executor = {} as DbTransaction;
const typesOf = (calls: unknown[][]) => calls.map(([ev]) => (ev as { type: string }).type);

beforeEach(() => { emit.mockReset(); emitInTx.mockReset().mockResolvedValue({}); outcome.mockReset().mockResolvedValue(undefined); });

describe('emitTasksEnteredEvents', () => {
  it('待办任务按顺序持久化 node.entered → task.created → task.assigned', async () => {
    await emitTasksEnteredEvents(10, [task({ id: 1, nodeKey: 'a' }), task({ id: 2, nodeKey: 'b' })], meta, executor);
    expect(typesOf(emitInTx.mock.calls)).toEqual([
      'node.entered', 'task.created', 'task.assigned',
      'node.entered', 'task.created', 'task.assigned',
    ]);
    expect(emitInTx.mock.calls[0][0]).toMatchObject({ instanceId: 10, definitionId: 3, nodeKey: 'a', nodeName: '审批', nodeType: 'approve', actor: meta.actor });
    expect(emitInTx.mock.calls[1][0]).toMatchObject({ type: 'task.created', task: { id: 1, nodeKey: 'a' } });
    expect(emit).not.toHaveBeenCalled();
  });

  it('自动通过 / 驳回的任务补发对应终态事件，无处理人或非 pending 不发 assigned', async () => {
    await emitTasksEnteredEvents(10, [
      task({ id: 1, status: 'approved' }),
      task({ id: 2, status: 'rejected', assigneeId: null }),
      task({ id: 3, status: 'pending', assigneeId: null }),
    ], meta, executor);
    expect(typesOf(emitInTx.mock.calls)).toEqual([
      'node.entered', 'task.created', 'task.approved',
      'node.entered', 'task.created', 'task.rejected',
      'node.entered', 'task.created',
    ]);
  });

  it('传 executor 时全部经 emitInTx 入队 outbox，返回可 await 的 Promise', async () => {
    const executor = {} as DbTransaction;
    const result = emitTasksEnteredEvents(10, [task({ id: 1 })], meta, executor);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(emit).not.toHaveBeenCalled();
    expect(typesOf(emitInTx.mock.calls)).toEqual(['node.entered', 'task.created', 'task.assigned']);
    expect(emitInTx.mock.calls.every(([, ex]) => ex === executor)).toBe(true);
  });

  it('空任务列表不发任何事件', async () => {
    await emitTasksEnteredEvents(10, [], meta, executor);
    expect(emitInTx).not.toHaveBeenCalled();
  });

  it('持久化失败向调用方传播，后续任务事件不再写入', async () => {
    emitInTx.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(emitTasksEnteredEvents(10, [task({ id: 1 }), task({ id: 2 })], meta, executor)).rejects.toThrow('outbox unavailable');
    expect(emitInTx).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });
});


describe('emitInstanceEvent transaction authority', () => {
  const instance = { id: 10, definitionId: 3, tenantId: null, bizType: 'access_request', status: 'approved' } as Parameters<typeof emitInstanceEvent>[1];

  it('审批结果先同步回写业务，再在同一事务保存事件', async () => {
    await emitInstanceEvent('instance.approved', instance, meta.actor, executor);
    expect(outcome).toHaveBeenCalledWith(executor, instance, meta.actor.userId);
    expect(outcome.mock.invocationCallOrder[0]).toBeLessThan(emitInTx.mock.invocationCallOrder[0]);
    expect(emitInTx.mock.calls[0][1]).toBe(executor);
  });

  it('业务同步回写失败时拒绝发布终态事件', async () => {
    outcome.mockRejectedValueOnce(new Error('grant rejected'));
    await expect(emitInstanceEvent('instance.approved', instance, meta.actor, executor)).rejects.toThrow('grant rejected');
    expect(emitInTx).not.toHaveBeenCalled();
  });

  it('实例创建不调用终态业务钩子', async () => {
    await emitInstanceEvent('instance.created', instance, meta.actor, executor);
    expect(outcome).not.toHaveBeenCalled();
    expect(emitInTx).toHaveBeenCalledOnce();
  });
});
