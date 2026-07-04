/**
 * 乐观锁重试工具单测（纯函数，无 DB 依赖）。
 *
 * 测试 `withOptimisticRetry`：首次成功、冲突后重试成功、重试耗尽转 409、
 * 非乐观锁错误（业务 HTTPException / 普通 Error）不重试直接透传。
 */
import { describe, it, expect, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { withOptimisticRetry, OptimisticLockError } from './optimistic';

describe('withOptimisticRetry', () => {
  it('首次成功：直接返回结果，仅执行一次', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withOptimisticRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('乐观锁冲突后重试成功：返回最终结果', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new OptimisticLockError())
      .mockRejectedValueOnce(new OptimisticLockError())
      .mockResolvedValue(42);
    await expect(withOptimisticRetry(fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('重试耗尽：抛 409，执行次数等于 retries', async () => {
    const fn = vi.fn().mockRejectedValue(new OptimisticLockError());
    await expect(withOptimisticRetry(fn)).rejects.toHaveProperty('status', 409);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('自定义重试次数生效', async () => {
    const fn = vi.fn().mockRejectedValue(new OptimisticLockError());
    await expect(withOptimisticRetry(fn, 5)).rejects.toBeInstanceOf(HTTPException);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('业务错误（HTTPException 400）不重试，原样抛出', async () => {
    const err = new HTTPException(400, { message: '余额不足' });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withOptimisticRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('普通 Error 不重试，原样抛出', async () => {
    const err = new Error('db down');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withOptimisticRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('冲突后恢复的结果不受之前失败影响（事务重试语义）', async () => {
    let attempt = 0;
    const result = await withOptimisticRetry(async () => {
      attempt += 1;
      if (attempt < 2) throw new OptimisticLockError();
      return { balance: 100, version: attempt };
    });
    expect(result).toEqual({ balance: 100, version: 2 });
  });
});
