import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from '@zenith/shared/core';
import { analyticsStorageKey } from '@zenith/analytics-sdk/runtime-config';
import { config } from '@/config';
import { configureErrorReporterRuntime, configureErrorReporting, reportError } from './error-reporter';

vi.mock('./breadcrumbs', () => ({
  getBreadcrumbs: () => [],
}));

describe('error reporting policy', () => {
  const fetchMock = vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }));

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    configureErrorReporterRuntime({
      tokenKey: TOKEN_KEY,
      source: 'web_admin',
      appId: 'admin',
      environment: 'development',
      consentProvider: () => true,
    });
    configureErrorReporting({ enabled: true, trackErrors: true, respectDnt: false });
  });

  it('stops error telemetry when collection is disabled', () => {
    configureErrorReporting({ enabled: false, trackErrors: true, respectDnt: false });
    reportError('js_error', 'disabled telemetry');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports errors when the policy permits it', () => {
    reportError('js_error', 'enabled telemetry');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses member-specific token, session and platform fields', () => {
    configureErrorReporterRuntime({
      tokenKey: 'zenith_member_token',
      source: 'web_member',
      appId: 'member',
      environment: 'production',
      consentProvider: () => true,
    });
    localStorage.setItem('zenith_member_token', 'member-token');
    // 会话 key 按部署隔离命名（与 tracker-runtime.test.ts 同格式），旧的无 namespace key 不再读取
    sessionStorage.setItem(analyticsStorageKey(config.deploymentId, 'zenith_tracker_sid', 'member'), 'member-session');

    reportError('js_error', 'member telemetry');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect((init.headers as Record<string, string>).Authorization).toContain('member-token');
    expect(payload).toMatchObject({
      source: 'web_member',
      appId: 'member',
      environment: 'production',
      sessionId: 'member-session',
    });
  });
});
