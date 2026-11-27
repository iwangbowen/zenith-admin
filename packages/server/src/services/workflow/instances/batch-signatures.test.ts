import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const mocks = vi.hoisted(() => ({ approve: vi.fn(), select: vi.fn() }));
vi.mock('../../../db', () => ({ db: { select: mocks.select } }));
vi.mock('../../../lib/context', () => ({ currentUser: () => ({ userId: 1, tenantId: 1 }) }));
vi.mock('./task-actions', () => ({ approveTaskInBatch: mocks.approve, rejectTask: vi.fn() }));
vi.mock('./cc-urge', () => ({ urgeInstance: vi.fn() }));
vi.mock('./lifecycle', () => ({ withdrawInstance: vi.fn() }));
import { batchApproveTasks } from './batch';

beforeEach(() => {
  mocks.approve.mockReset();
  mocks.select.mockReset();
  let queryIndex = 0;
  mocks.select.mockImplementation(() => {
    const rows = queryIndex++ === 0
      ? [{ id: 1, instanceId: 20, nodeKey: 'approve' }, { id: 2, instanceId: 20, nodeKey: 'approve' }]
      : [{ id: 20, definitionSnapshot: { flowData: { nodes: [], edges: [] } } }];
    const query = { from: () => query, innerJoin: () => query, where: async () => rows };
    return query;
  });
});

describe('batch signature execution', () => {
  it('forwards one confirmed saved input to each unique authorized task and preserves partial outcomes', async () => {
    const signature = { source: 'saved', signatureId: 4, version: 2 } as const;
    mocks.approve.mockImplementation(async (id: number) => {
      if (id === 2) throw new HTTPException(400, { message: '该节点要求每次手写，请单独审批' });
    });
    const result = await batchApproveTasks([1, 2, 3, 1], '同意', signature);
    expect(mocks.approve.mock.calls).toEqual([[1, '同意', signature], [2, '同意', signature]]);
    expect(result).toEqual([
      { taskId: 1, success: true },
      { taskId: 2, success: false, message: '该节点要求每次手写，请单独审批' },
      { taskId: 3, success: false, message: '任务不存在、无权操作或已处理' },
      { taskId: 1, success: true },
    ]);
  });
});
