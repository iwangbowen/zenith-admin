import { describe, expect, it, vi } from 'vitest';
import { checkNodeCompletion, filterCurrentActivation } from './materialize';
import type { DbExecutor } from '../../../db/types';

type Row = { id: number; activationId: string; status?: string; nodeType?: string | null; signType?: string | null };

describe('filterCurrentActivation 节点重入轮次过滤', () => {
  it('只保留最新 activationId 的任务（历史轮 rejected 不参与判定）', () => {
    const rows: Row[] = [
      { id: 1, activationId: 'round-1', status: 'rejected' },
      { id: 2, activationId: 'round-1', status: 'skipped' },
      { id: 3, activationId: 'round-2', status: 'pending' },
      { id: 4, activationId: 'round-2', status: 'approved' },
    ];
    const filtered = filterCurrentActivation(rows);
    expect(filtered.map((r) => r.id)).toEqual([3, 4]);
  });

  it('空数组直接返回', () => {
    expect(filterCurrentActivation([])).toEqual([]);
  });

  it('同轮加签任务（继承 activationId）与原任务同轮统计', () => {
    const rows: Row[] = [
      { id: 1, activationId: 'round-2', status: 'pending' },
      { id: 5, activationId: 'round-2', status: 'pending' }, // 加签继承
      { id: 3, activationId: 'round-1', status: 'rejected' },
    ];
    const filtered = filterCurrentActivation(rows);
    expect(filtered.map((r) => r.id).sort()).toEqual([1, 5]);
  });

  it('转发抄送行（ccNode + 更大的 id / 另一个 activation）不参与轮次推断', () => {
    const rows: Row[] = [
      { id: 205, activationId: 'round-1', status: 'approved', nodeType: 'approve' },
      { id: 206, activationId: 'round-1', status: 'pending', nodeType: 'approve' },
      { id: 208, activationId: 'cc-uuid', status: 'skipped', nodeType: 'ccNode' },
    ];
    const filtered = filterCurrentActivation(rows);
    expect(filtered.map((r) => r.id)).toEqual([205, 206]);
  });

  it('excluded 留痕行同样不参与轮次推断', () => {
    const rows: Row[] = [
      { id: 10, activationId: 'round-1', status: 'pending', nodeType: 'approve' },
      { id: 11, activationId: 'excluded-x', status: 'skipped', nodeType: 'approve', signType: 'excluded' },
    ];
    expect(filterCurrentActivation(rows).map((r) => r.id)).toEqual([10]);
  });

  it('节点下只有抄送行时退化为按全部行推断（保持纯抄送节点语义）', () => {
    const rows: Row[] = [
      { id: 1, activationId: 'cc-1', status: 'skipped', nodeType: 'ccNode' },
      { id: 2, activationId: 'cc-2', status: 'skipped', nodeType: 'ccNode' },
    ];
    expect(filterCurrentActivation(rows).map((r) => r.id)).toEqual([2]);
  });
});

/** 构造只支持 checkNodeCompletion 所需链式调用的 fake 事务执行器 */
function fakeTx(rows: Array<Record<string, unknown>>, onUpdate?: (patch: Record<string, unknown>) => void): DbExecutor {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        onUpdate?.(patch);
        return { where: () => Promise.resolve([]) };
      },
    }),
  } as unknown as DbExecutor;
}

describe('checkNodeCompletion before-加签恢复（signType 判定，回归 comment 被覆盖导致的死锁）', () => {
  const base = { instanceId: 1, nodeKey: 'n1', activationId: 'round-1', taskOrder: null as number | null };

  it('前加签任务经委派回执后 comment 被覆盖，仍按 signType 恢复挂起原任务', async () => {
    const restored: Array<Record<string, unknown>> = [];
    // 场景：原任务 waiting；前加签任务被委派 → 原加签任务 approved（comment 已被回执覆盖）+ 回执确认任务 approved（signType 继承）
    const rows = [
      { ...base, id: 1, status: 'waiting', signType: null, comment: null, approveMethod: 'or' },
      { ...base, id: 2, status: 'approved', signType: 'before', comment: '[委派回执] 某人 建议同意', approveMethod: 'or' },
      { ...base, id: 3, status: 'approved', signType: 'before', comment: '[委派回执] 某人 建议同意', approveMethod: 'or' },
    ];
    const tx = fakeTx(rows, (patch) => restored.push(patch));
    const { completed } = await checkNodeCompletion(tx, 1, 'n1');
    // 原任务被升回 pending（写库一次），节点因原任务恢复 pending 而尚未完成
    expect(restored.some((p) => p.status === 'pending')).toBe(true);
    expect(completed).toBe(false);
  });

  it('前加签任务未全部处理时不恢复原任务，节点不可能完成', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const rows = [
      { ...base, id: 1, status: 'waiting', signType: null, comment: null, approveMethod: 'or' },
      { ...base, id: 2, status: 'pending', signType: 'before', comment: '[加签-前] 由 张三 发起', approveMethod: 'or' },
    ];
    const tx = fakeTx(rows, (patch) => updates.push(patch));
    const { completed } = await checkNodeCompletion(tx, 1, 'n1');
    expect(updates).toHaveLength(0);
    expect(completed).toBe(false);
  });

  it('减签（skipped）视同已处理，同样恢复挂起原任务', async () => {
    const restored = vi.fn();
    const rows = [
      { ...base, id: 1, status: 'waiting', signType: null, comment: null, approveMethod: 'or' },
      { ...base, id: 2, status: 'skipped', signType: 'before', comment: '[减签] 由 张三 发起', approveMethod: 'or' },
    ];
    const tx = fakeTx(rows, restored);
    await checkNodeCompletion(tx, 1, 'n1');
    expect(restored).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });
});

describe('checkNodeCompletion 与同 nodeKey 的抄送行（回归 #73：会签节点被提前判定完成）', () => {
  const base = { instanceId: 73, nodeKey: 'approve_dept', taskOrder: null as number | null };

  it('节点上存在更高 id 的转发抄送行时，会签未齐不得判定完成', async () => {
    const rows = [
      { ...base, id: 205, activationId: 'round-1', status: 'approved', nodeType: 'approve', signType: null, approveMethod: 'and' },
      { ...base, id: 206, activationId: 'round-1', status: 'pending', nodeType: 'approve', signType: 'parallel', approveMethod: 'and' },
      { ...base, id: 208, activationId: 'cc-uuid', status: 'skipped', nodeType: 'ccNode', signType: null, approveMethod: null },
    ];
    const updates: Array<Record<string, unknown>> = [];
    const tx = fakeTx(rows, (patch) => updates.push(patch));
    const { completed, method } = await checkNodeCompletion(tx, 73, 'approve_dept');
    expect(method).toBe('and');
    expect(completed).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('其余审批人全部处理完毕后节点完成，并清场同轮残留待办', async () => {
    const rows = [
      { ...base, id: 205, activationId: 'round-1', status: 'approved', nodeType: 'approve', signType: null, approveMethod: 'and' },
      { ...base, id: 209, activationId: 'round-1', status: 'pending', nodeType: 'ccNode', signType: null, approveMethod: null },
    ];
    const updates: Array<Record<string, unknown>> = [];
    const tx = fakeTx(rows, (patch) => updates.push(patch));
    const { completed } = await checkNodeCompletion(tx, 73, 'approve_dept');
    expect(completed).toBe(true);
    // 抄送行不阻塞判定，但完成后统一清场（pending/waiting → skipped + 留痕）
    expect(updates[0]).toMatchObject({ status: 'skipped' });
    expect(String(updates[0].comment)).toContain('[会签完成]');
  });
});
