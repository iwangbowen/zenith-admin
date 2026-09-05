/**
 * push 域缓存一致性契约。
 *
 * 关键判据:
 *  1. 测试发送产生发送记录 → 失效记录列表;配置自身不变,不得打回配置列表。
 *  2. 保存配置只失效配置域,不触及发送记录。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { PushConfig } from '@zenith/shared/messaging';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  pushConfigKeys,
  pushSendLogKeys,
  usePushConfigList,
  usePushSendLogList,
  useSavePushConfig,
  useTestPushSend,
} from './push';

const CONFIG: PushConfig = {
  id: 1, appId: 2, appName: 'Zenith 移动端', name: '极光-生产', provider: 'jpush', appKey: 'a1b2******c3d4',
  apnsProduction: false, status: 'enabled', remark: null,
  createdAt: '2026-08-26 10:00:00', updatedAt: '2026-08-26 10:00:00',
};

const LIST_PARAMS = { page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/push-configs', { list: [CONFIG], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/push-send-logs', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('PUT', '/api/push-configs/1', { ...CONFIG, name: '极光(改)' })
    .on('POST', '/api/push-configs/1/test', { msgId: 'demo-1' });
});

function mountPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      configs: usePushConfigList(LIST_PARAMS),
      logs: usePushSendLogList(LIST_PARAMS),
      save: useSavePushConfig(),
      test: useTestPushSend(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.configs.isSuccess).toBe(true);
    expect(hook.result.current.logs.isSuccess).toBe(true);
  });
}

describe('useTestPushSend', () => {
  it('refreshes send logs (a new log row is produced) but leaves configs untouched', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.test.mutateAsync({ params: { id: 1 }, body: { registrationId: 'reg-1', title: 't', content: 'c' } });
    await waitFor(() => expect(hook.result.current.logs.isFetching).toBe(false));

    expect(fetches.countOf(pushSendLogKeys.lists)).toBe(1);
    expect(fetches.countOf(pushConfigKeys.lists)).toBe(0);
    expect(api.countOf('GET', '/api/push-configs')).toBe(0);

    fetches.stop();
  });
});

describe('useSavePushConfig（工厂接线）', () => {
  it('refreshes config list on save without touching send logs', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.save.mutateAsync({ id: 1, values: { name: '极光(改)' } });
    await waitFor(() => expect(hook.result.current.configs.isFetching).toBe(false));

    expect(fetches.countOf(pushConfigKeys.lists)).toBe(1);
    expect(fetches.countOf(pushSendLogKeys.lists)).toBe(0);
    expect(api.countOf('GET', '/api/push-send-logs')).toBe(0);

    fetches.stop();
  });
});
