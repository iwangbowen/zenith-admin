import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_EXPERIMENT_EXPOSURE_EVENT, TOKEN_KEY } from '@zenith/shared';

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

vi.mock('./error-reporter', () => ({
  configureErrorReporting,
  configureErrorReporterRuntime,
  reportError,
}));

vi.mock('@zenith/analytics-sdk/error-reporter', () => ({
  configureErrorReporting,
  configureErrorReporterRuntime,
  reportError,
}));

describe('analytics tracker P0 reliability', () => {
  const fetchMock = vi.fn();
  const sendBeacon = vi.fn(() => true);
  let tracker: typeof import('./tracker');

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/analytics/config')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              enabled: true,
              sampleRate: 1,
              trackPageviews: true,
              trackClicks: false,
              trackPerformance: false,
              trackErrors: true,
              trackApi: false,
              maskInputs: true,
              respectDnt: false,
              blacklistPaths: [],
              sessionTimeoutMinutes: 45,
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ code: 0, data: null }) } as Response;
    });
    tracker = await import('./tracker');
    tracker.initTracker();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => expect(configureErrorReporting).toHaveBeenCalled());
  });

  beforeEach(() => {
    fetchMock.mockClear();
    sendBeacon.mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('adds stable UUID event IDs and flushes the old identity with its current token', () => {
    localStorage.setItem(TOKEN_KEY, 'account-a-token');
    tracker.identify(7, 'account-a');
    tracker.trackEvent('order_submit', { amount: 100 });
    tracker.prepareTrackerLogout();

    const configCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/analytics/config'));
    expect(((configCall?.[1] as RequestInit).headers as Record<string, string>).Authorization).toContain('account-a-token');
    const ingestCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/analytics/events'));
    expect(ingestCall).toBeDefined();
    const request = ingestCall?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { events: Array<{ eventId?: string; distinctId?: string }> };
    expect(body.events).toHaveLength(2);
    expect(body.events.every((event) => /^[0-9a-f-]{36}$/i.test(event.eventId ?? ''))).toBe(true);
    expect(body.events.every((event) => event.distinctId === 'u:7')).toBe(true);
    expect((request.headers as Record<string, string>).Authorization).toContain('account-a-token');
    expect(sessionStorage.getItem('zenith_tracker_sid')).toBeNull();
  });

  it('does not use sendBeacon for authenticated unload events', () => {
    localStorage.setItem(TOKEN_KEY, 'account-a-token');
    tracker.identify(7, 'account-a');
    tracker.trackEvent('page_action');
    document.dispatchEvent(new Event('pagehide'));
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes('/analytics/events') && (init as RequestInit).keepalive === true,
    )).toBe(true);
  });

  it('caches experiment assignments and deduplicates exposure per session', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/analytics/config')) {
        return { ok: true, json: async () => ({ code: 0, data: { enabled: true, sampleRate: 1, trackPageviews: true, trackClicks: true, trackPerformance: true, trackErrors: true, trackApi: true, maskInputs: true, respectDnt: false, blacklistPaths: [], sessionTimeoutMinutes: 30 } }) } as Response;
      }
      if (url.includes('/analytics/experiments/assignments')) {
        return { ok: true, json: async () => ({ code: 0, data: [{ expKey: 'homepage_banner', variantKey: 'control' }] }) } as Response;
      }
      return { ok: true, json: async () => ({ code: 0, data: null }) } as Response;
    });

    await expect(tracker.getVariant('homepage_banner')).resolves.toBe('control');
    await expect(tracker.getVariant('homepage_banner')).resolves.toBe('control');
    tracker.prepareTrackerLogout();

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/analytics/experiments/assignments'))).toHaveLength(1);
    const ingestCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/analytics/events'));
    const body = JSON.parse(String((ingestCall?.[1] as RequestInit).body)) as { events: Array<{ eventName?: string; properties?: Record<string, unknown> }> };
    const exposures = body.events.filter((event) => event.eventName === ANALYTICS_EXPERIMENT_EXPOSURE_EVENT);
    expect(exposures).toHaveLength(1);
    expect(exposures[0].properties).toMatchObject({ expKey: 'homepage_banner', variantKey: 'control' });
  });
});
