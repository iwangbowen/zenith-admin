/**
 * broadcasts 域缓存一致性契约。
 *
 * 关键判据:
 *  1. 发送活动改变状态并产生任务 → 失效整个群发域(列表须刷新);
 *  2. 保存活动只失效群发域,不触及推送记录等相邻域。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { BroadcastCampaign } from '@zenith/shared/messaging';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { broadcastKeys, useBroadcastList, useSaveBroadcast, useSendBroadcast } from './broadcasts';
import { pushSendLogKeys, usePushSendLogList } from './push';

const CAMPAIGN: BroadcastCampaign = {
  id: 1, title: '五一服务安排', content: '客服时间调整', link: null,
  channels: ['inapp'], audienceType: 'all_users', audienceIds: [],
  status: 'draft', totalRecipients: null, enqueuedCount: 0, taskId: null,
  sentAt: null, remark: null, createdBy: 1, createdByName: '管理员',
  createdAt: '2026-08-27 10:00:00', updatedAt: '2026-08-27 10:00:00',
};

const LIST_PARAMS = { page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/broadcasts', { list: [CAMPAIGN], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/push-send-logs', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('PUT', '/api/broadcasts/1', { ...CAMPAIGN, title: '改' })
    .on('POST', '/api/broadcasts/1/send', { id: 9, taskType: 'messaging-broadcast', status: 'pending' });
});

function mountPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      list: useBroadcastList(LIST_PARAMS),
      logs: usePushSendLogList(LIST_PARAMS),
      save: useSaveBroadcast(),
      send: useSendBroadcast(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.list.isSuccess).toBe(true);
    expect(hook.result.current.logs.isSuccess).toBe(true);
  });
}

describe('useSendBroadcast', () => {
  it('refreshes broadcast list after send without touching push logs', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.send.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(broadcastKeys.lists)).toBe(1);
    expect(fetches.countOf(pushSendLogKeys.lists)).toBe(0);
    expect(api.countOf('GET', '/api/push-send-logs')).toBe(0);

    fetches.stop();
  });
});

describe('useSaveBroadcast（工厂接线）', () => {
  it('refreshes broadcast list on save', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.save.mutateAsync({
      id: 1,
      values: { title: '改', content: 'c', channels: ['inapp'], audienceType: 'all_users', audienceIds: [] },
    });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(broadcastKeys.lists)).toBe(1);
    expect(api.countOf('GET', '/api/push-send-logs')).toBe(0);

    fetches.stop();
  });
});
