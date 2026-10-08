import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger', () => ({ default: { warn: vi.fn() } }));
import logger from '../lib/logger';
import { withTimeout } from './shutdown';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('停机清理超时', () => {
  it('清理成功后取消计时器，不产生虚假超时日志', async () => {
    vi.useFakeTimers();
    await withTimeout('subscriber', Promise.resolve(), 1000);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('清理失败时取消计时器并保留原异常', async () => {
    vi.useFakeTimers();
    await expect(withTimeout('subscriber', Promise.reject(new Error('cleanup failed')), 1000)).rejects.toThrow('cleanup failed');
    expect(vi.getTimerCount()).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('清理卡住时仍按时告警并继续后续步骤', async () => {
    vi.useFakeTimers();
    const stopped = withTimeout('subscriber', new Promise(() => {}), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(stopped).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('Shutdown step "subscriber" timed out after 1000ms, continuing');
    expect(vi.getTimerCount()).toBe(0);
  });
});
