/**
 * 通知偏好域 hooks 的失效行为测试。
 *
 * 锁定两条契约：
 * 1. 保存偏好只回源矩阵，不波及全局设置（两者生命周期独立）；
 * 2. 保存设置用同源响应回填，不触发任何重拉。
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  getCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  notificationPreferenceKeys,
  useNotificationMatrix,
  useNotificationSettings,
  useSaveNotificationPreferences,
  useSaveNotificationSettings,
} from './notification-preferences';

const MATRIX = [{ group: 'wiki', label: '知识中心', events: [] }];
const SETTINGS = {
  recipientType: 'user', recipientId: 1, globalMuted: false, timezone: 'Asia/Shanghai',
  quietStart: null, quietEnd: null, digestMode: 'realtime', digestHour: 9,
  updatedAt: '2026-08-18 10:00:00',
};

beforeEach(() => {
  api.reset();
  api.on('GET', '/api/notification-preferences/matrix', MATRIX);
  api.on('GET', '/api/notification-preferences/settings', SETTINGS);
  api.on('PUT', '/api/notification-preferences/matrix', null);
  api.on('PUT', '/api/notification-preferences/settings', { ...SETTINGS, globalMuted: true, updatedAt: '2026-08-18 11:00:00' });
});

describe('notification-preferences hooks', () => {
  it('保存偏好后矩阵回源重拉，全局设置保持 fresh 不受波及', async () => {
    const client = createTestQueryClient();
    const wrapper = createWrapper(client);

    const matrix = renderHook(() => useNotificationMatrix(), { wrapper });
    const settings = renderHook(() => useNotificationSettings(), { wrapper });
    await waitFor(() => {
      expect(matrix.result.current.isSuccess).toBe(true);
      expect(settings.result.current.isSuccess).toBe(true);
    });

    const fetches = observeFetches(client);
    api.resetCalls();

    const save = renderHook(() => useSaveNotificationPreferences(), { wrapper });
    save.result.current.mutate({ body: { items: [{ eventKey: 'wiki.doc.commented', channel: 'email', enabled: true }] } });
    await waitFor(() => expect(save.result.current.isSuccess).toBe(true));

    // 矩阵是唯一被打回源的查询
    await waitFor(() => expect(api.countOf('GET', '/api/notification-preferences/matrix')).toBe(1));
    expect(fetches.countOf(notificationPreferenceKeys.matrix)).toBe(1);
    expect(fetches.countOf(notificationPreferenceKeys.settings)).toBe(0);
    expect(api.countOf('GET', '/api/notification-preferences/settings')).toBe(0);
    expect(isFresh(client, notificationPreferenceKeys.settings)).toBe(true);
    fetches.stop();
  });

  it('保存设置回填同源响应，矩阵与设置都不重拉', async () => {
    const client = createTestQueryClient();
    const wrapper = createWrapper(client);

    const matrix = renderHook(() => useNotificationMatrix(), { wrapper });
    const settings = renderHook(() => useNotificationSettings(), { wrapper });
    await waitFor(() => {
      expect(matrix.result.current.isSuccess).toBe(true);
      expect(settings.result.current.isSuccess).toBe(true);
    });

    const fetches = observeFetches(client);
    api.resetCalls();

    const save = renderHook(() => useSaveNotificationSettings(), { wrapper });
    save.result.current.mutate({
      body: {
        globalMuted: true, timezone: 'Asia/Shanghai',
        quietStart: null, quietEnd: null, digestMode: 'realtime', digestHour: 9,
      },
    });
    await waitFor(() => expect(save.result.current.isSuccess).toBe(true));

    // 回填生效：缓存已是新值，且没有任何 GET 请求发生
    expect(getCacheEntry<typeof SETTINGS>(client, notificationPreferenceKeys.settings)?.globalMuted).toBe(true);
    expect(fetches.count).toBe(0);
    expect(api.countOf('GET')).toBe(0);
    fetches.stop();
  });
});
