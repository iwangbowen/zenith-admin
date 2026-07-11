import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_CONFIG_VERSION_KEY } from '@zenith/shared';

/**
 * 行为中心阶段 1：设置热更新（tracker 侧）测试。
 * 覆盖点：
 * - init 后 60s 兜底轮询会重新拉取 /analytics/config
 * - 同浏览器其它标签写入 ANALYTICS_CONFIG_VERSION_KEY 触发的 storage 事件会立即重拉配置
 * - 导出的 reloadTrackerConfig() 可手动触发一次重拉
 * - 重复调用 init 不会注册多个定时器/监听（不会导致重复请求）
 */

vi.mock('web-vitals', () => ({
  onCLS: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  onFCP: vi.fn(),
  onTTFB: vi.fn(),
}));

vi.mock('@zenith/analytics-sdk/error-reporter', () => ({
  configureErrorReporting: vi.fn(),
  configureErrorReporterRuntime: vi.fn(),
  reportError: vi.fn(),
}));

describe('tracker 设置热更新', () => {
  const fetchMock = vi.fn();
  let tracker: typeof import('./tracker');

  function configResponse() {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          enabled: true, sampleRate: 1, trackPageviews: true, trackClicks: true, trackPerformance: true,
          trackErrors: true, trackApi: true, maskInputs: true, respectDnt: false, blacklistPaths: [],
          sessionTimeoutMinutes: 30,
        },
      }),
    } as Response;
  }

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/analytics/config')) return configResponse();
      return { ok: true, json: async () => ({ code: 0, data: null }) } as Response;
    });
    tracker = await import('./tracker');
    tracker.initTracker();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });

  beforeEach(() => {
    fetchMock.mockClear();
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('60s 兜底轮询会重新拉取配置', async () => {
    const configCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/analytics/config'));
    expect(configCalls().length).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(configCalls().length).toBeGreaterThanOrEqual(1);
  });

  it('其它标签写入配置版本号触发 storage 事件后立即重拉', async () => {
    fetchMock.mockClear();
    window.dispatchEvent(new StorageEvent('storage', { key: ANALYTICS_CONFIG_VERSION_KEY, newValue: String(Date.now()) }));
    await Promise.resolve(); await Promise.resolve();
    const configCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/analytics/config'));
    expect(configCalls.length).toBe(1);
  });

  it('不相关 key 的 storage 事件不会触发重拉', async () => {
    fetchMock.mockClear();
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated_key', newValue: 'x' }));
    await Promise.resolve(); await Promise.resolve();
    const configCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/analytics/config'));
    expect(configCalls.length).toBe(0);
  });

  it('reloadTrackerConfig() 手动触发一次重拉', async () => {
    fetchMock.mockClear();
    tracker.reloadTrackerConfig();
    await Promise.resolve(); await Promise.resolve();
    const configCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/analytics/config'));
    expect(configCalls.length).toBe(1);
  });

  it('重复调用 initTracker 不会注册多个定时器（60s 内只触发一次兜底轮询）', async () => {
    tracker.initTracker();
    tracker.initTracker();
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    const configCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/analytics/config'));
    expect(configCalls.length).toBe(1);
  });
});
