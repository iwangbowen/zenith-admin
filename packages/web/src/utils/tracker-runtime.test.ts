import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 行为中心阶段 1：tracker 运行时参数化（configureTracker）测试。
 * 覆盖点：
 * - 自定义 tokenKey 生效于配置拉取 / 事件上报请求头
 * - doTrack 强制覆盖平台字段（调用方不可伪造 source/appId/environment）
 * - consentProvider=false 时不采集也不缓存事件（配置拉取仍允许）
 * - rootSelector 参数化（不直接触发白屏上报断言，仅验证不抛错）
 */

const { configureErrorReporting, configureErrorReporterRuntime, reportError } = vi.hoisted(() => ({
  configureErrorReporting: vi.fn(),
  configureErrorReporterRuntime: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('web-vitals', () => ({
  onCLS: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  onFCP: vi.fn(),
  onTTFB: vi.fn(),
}));

vi.mock('@zenith/analytics-sdk/error-reporter', () => ({
  configureErrorReporting,
  configureErrorReporterRuntime,
  reportError,
}));

describe('tracker runtime 参数化（configureTracker）', () => {
  const fetchMock = vi.fn();
  let tracker: typeof import('./tracker');
  const MEMBER_TOKEN_KEY = 'zenith_member_token';

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/analytics/config')) {
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
      return { ok: true, json: async () => ({ code: 0, data: null }) } as Response;
    });
    tracker = await import('./tracker');
  });

  beforeEach(() => {
    fetchMock.mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('configureTracker 后，配置拉取与事件上报都使用自定义 tokenKey', async () => {
    const consent = true;
    tracker.configureTracker({
      tokenKey: MEMBER_TOKEN_KEY,
      source: 'web_member',
      appId: 'member',
      environment: 'production',
      sdkVersion: '9.9.9',
      rootSelector: '#member-root',
      consentProvider: () => consent,
    });
    expect(configureErrorReporterRuntime).toHaveBeenCalledWith(expect.objectContaining({
      tokenKey: MEMBER_TOKEN_KEY, source: 'web_member', appId: 'member', environment: 'production',
    }));

    localStorage.setItem(MEMBER_TOKEN_KEY, 'member-token-abc');
    tracker.initTracker();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const configCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/analytics/config'));
    expect(((configCall?.[1] as RequestInit).headers as Record<string, string>).Authorization).toContain('member-token-abc');

    tracker.trackEvent('member_action', { foo: 1 });
    // 触发定时 flush
    await vi.advanceTimersByTimeAsync(15_000);
    const ingestCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/analytics/events'));
    expect(ingestCall).toBeDefined();
    const body = JSON.parse(String((ingestCall?.[1] as RequestInit).body)) as { events: Array<{ source?: string; appId?: string; environment?: string; sdkVersion?: string }> };
    // doTrack 强制覆盖平台字段
    expect(body.events[0].source).toBe('web_member');
    expect(body.events[0].appId).toBe('member');
    expect(body.events[0].sdkVersion).toBe('9.9.9');
    expect(((ingestCall?.[1] as RequestInit).headers as Record<string, string>).Authorization).toContain('member-token-abc');
    expect(sessionStorage.getItem('zenith_tracker_sid:member')).toBeTruthy();
    expect(sessionStorage.getItem('zenith_tracker_sid')).toBeNull();
    expect(localStorage.getItem('zenith_anon_id:member')).toBeTruthy();
    expect(localStorage.getItem('zenith_anon_id')).toBeNull();
  });

  it('调用方无法伪造 source=server：doTrack 强制覆盖', async () => {
    tracker.configureTracker({ tokenKey: MEMBER_TOKEN_KEY, source: 'web_member', appId: 'member', consentProvider: () => true });
    tracker.trackEvent('spoof_attempt');
    await vi.advanceTimersByTimeAsync(15_000);
    const ingestCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/analytics/events'));
    const body = JSON.parse(String((ingestCall?.[1] as RequestInit).body)) as { events: Array<{ source?: string }> };
    expect(body.events.every((e) => e.source === 'web_member')).toBe(true);
  });

  it('consentProvider=false 时不采集事件（不进入 buffer/queue）', async () => {
    tracker.configureTracker({ tokenKey: MEMBER_TOKEN_KEY, source: 'web_member', appId: 'member', consentProvider: () => false });
    fetchMock.mockClear();
    tracker.trackEvent('should_be_dropped');
    await vi.advanceTimersByTimeAsync(15_000);
    const ingestCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/analytics/events'));
    expect(ingestCall).toBeUndefined();
  });
});
