/**
 * 流程连接器熔断器单测（时间型熔断 + 单次半开试探，Redis 状态机）。
 *
 * 覆盖要点：
 *  1. breakerAllow：禁用直通、open 快速失败、halfOpen 单次试探（NX 抢锁）、
 *     试探锁被占 → 拒绝、closed 放行、Redis 故障 fail-open
 *  2. breakerFailure：连续失败计数 + 首次设置滚动窗口 TTL、达阈值打开熔断
 *     （open TTL=cooldown、wasopen TTL=cooldown*4）、半开试探失败释放锁重新打开
 *  3. breakerSuccess：闭合清理三 key；breakerReset：清理四 key
 *  4. breakerState：三态展示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({
  config: { redis: { keyPrefix: 'test:' } },
}));

vi.mock('./redis', () => ({
  default: { exists: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn() },
}));

vi.mock('./logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import redis from './redis';
import { breakerAllow, breakerFailure, breakerSuccess, breakerState, breakerReset } from './workflow-connector-breaker';

const redisMock = vi.mocked(redis);
const CFG = { enabled: true, failureThreshold: 3, cooldownSec: 120 };

beforeEach(() => {
  vi.resetAllMocks();
  redisMock.exists.mockResolvedValue(0);
  redisMock.set.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
  redisMock.incr.mockResolvedValue(1);
  redisMock.expire.mockResolvedValue(1);
});

describe('breakerAllow', () => {
  it('熔断禁用 → 直接放行（不触 Redis）', async () => {
    const r = await breakerAllow(1, { ...CFG, enabled: false });
    expect(r).toEqual({ allowed: true, state: 'closed' });
    expect(redisMock.exists).not.toHaveBeenCalled();
  });

  it('open 标记存在 → 快速失败', async () => {
    redisMock.exists.mockResolvedValueOnce(1); // open key
    const r = await breakerAllow(1, CFG);
    expect(r).toEqual({ allowed: false, state: 'open' });
  });

  it('冷却结束（wasopen 存在）→ 半开抢到试探锁 → 放行一次', async () => {
    redisMock.exists.mockResolvedValueOnce(0).mockResolvedValueOnce(1); // open 无、wasopen 有
    redisMock.set.mockResolvedValueOnce('OK'); // NX 抢锁成功
    const r = await breakerAllow(1, CFG);
    expect(r).toEqual({ allowed: true, state: 'halfOpen' });
    expect(redisMock.set).toHaveBeenCalledWith('test:wfconn:half:1', '1', 'EX', 60, 'NX');
  });

  it('半开试探锁已被占 → 其余请求继续拒绝', async () => {
    redisMock.exists.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    redisMock.set.mockResolvedValueOnce(null); // NX 失败
    const r = await breakerAllow(1, CFG);
    expect(r).toEqual({ allowed: false, state: 'open' });
  });

  it('无任何标记 → closed 放行', async () => {
    const r = await breakerAllow(1, CFG);
    expect(r).toEqual({ allowed: true, state: 'closed' });
  });

  it('Redis 故障 → fail-open 放行（熔断是增强非硬依赖）', async () => {
    redisMock.exists.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await breakerAllow(1, CFG);
    expect(r).toEqual({ allowed: true, state: 'closed' });
  });
});

describe('breakerFailure', () => {
  it('禁用时不记录', async () => {
    await breakerFailure(1, { ...CFG, enabled: false });
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it('首次失败：释放半开锁 + 计数 1 并设置滚动窗口 TTL（≥60s）', async () => {
    redisMock.incr.mockResolvedValueOnce(1);
    await breakerFailure(1, CFG);
    expect(redisMock.del).toHaveBeenCalledWith('test:wfconn:half:1');
    expect(redisMock.expire).toHaveBeenCalledWith('test:wfconn:fail:1', 120); // max(cooldown, 60)
    expect(redisMock.set).not.toHaveBeenCalled(); // 未达阈值不打开
  });

  it('冷却时间小于 60s 时窗口 TTL 取 60s 下限', async () => {
    redisMock.incr.mockResolvedValueOnce(1);
    await breakerFailure(1, { ...CFG, cooldownSec: 10 });
    expect(redisMock.expire).toHaveBeenCalledWith('test:wfconn:fail:1', 60);
  });

  it('连续失败达阈值 → 打开熔断（open TTL=cooldown，wasopen TTL=cooldown*4）', async () => {
    redisMock.incr.mockResolvedValueOnce(3);
    await breakerFailure(1, CFG);
    expect(redisMock.set).toHaveBeenCalledWith('test:wfconn:open:1', expect.any(String), 'EX', 120);
    expect(redisMock.set).toHaveBeenCalledWith('test:wfconn:wasopen:1', '1', 'EX', 480);
  });

  it('Redis 故障静默（不向调用方抛错）', async () => {
    redisMock.incr.mockRejectedValue(new Error('down'));
    await expect(breakerFailure(1, CFG)).resolves.toBeUndefined();
  });
});

describe('breakerSuccess / breakerReset', () => {
  it('成功闭合：清空计数 / wasopen / 半开锁', async () => {
    await breakerSuccess(1);
    expect(redisMock.del).toHaveBeenCalledWith('test:wfconn:fail:1', 'test:wfconn:wasopen:1', 'test:wfconn:half:1');
  });

  it('手动重置：额外清理 open 标记', async () => {
    await breakerReset(1);
    expect(redisMock.del).toHaveBeenCalledWith(
      'test:wfconn:open:1',
      'test:wfconn:fail:1',
      'test:wfconn:wasopen:1',
      'test:wfconn:half:1',
    );
  });
});

describe('breakerState', () => {
  it('禁用 → closed', async () => {
    expect(await breakerState(1, false)).toBe('closed');
  });

  it('open 标记存在 → open', async () => {
    redisMock.exists.mockResolvedValueOnce(1);
    expect(await breakerState(1, true)).toBe('open');
  });

  it('仅 wasopen 存在 → halfOpen', async () => {
    redisMock.exists.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(await breakerState(1, true)).toBe('halfOpen');
  });

  it('无标记 → closed；Redis 故障 → closed', async () => {
    expect(await breakerState(1, true)).toBe('closed');
    redisMock.exists.mockRejectedValue(new Error('down'));
    expect(await breakerState(1, true)).toBe('closed');
  });
});
