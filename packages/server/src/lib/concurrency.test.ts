/**
 * 并发受限映射工具单测（仪表盘扇出取数防打爆连接池）。
 *
 * 覆盖：结果顺序保持、并发上限约束、并发数收敛（大于任务数/非法值）、
 * 异常传播、空数组。
 */
import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('mapWithConcurrency', () => {
  it('结果与输入顺序一致（即使完成顺序乱序）', async () => {
    const delays = [30, 0, 15];
    const result = await mapWithConcurrency(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `item-${i}`;
    });
    expect(result).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('并发数不超过上限', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('并发数大于任务数时按任务数收敛（不多开空 worker）', async () => {
    const result = await mapWithConcurrency([10, 20], 100, async (n) => n * 2);
    expect(result).toEqual([20, 40]);
  });

  it('并发数 ≤ 0 时按 1 串行执行（防御非法入参）', async () => {
    const order: number[] = [];
    await mapWithConcurrency([1, 2, 3], 0, async (n) => {
      order.push(n);
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('mapper 抛错 → 整体 reject', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('空数组 → 空结果', async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
  });

  it('每个元素恰好被处理一次（无重复领取）', async () => {
    const seen: number[] = [];
    const gate = deferred();
    const task = mapWithConcurrency([0, 1, 2, 3, 4], 3, async (n) => {
      seen.push(n);
      await gate.promise;
      return n;
    });
    gate.resolve();
    await task;
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
