/**
 * channels 域缓存一致性契约（S6 推广）
 *
 * 该域收敛前是「先 `.all` 再补具体键」的典型：菜单、自动回复、订阅者三类
 * mutation 都先失效了自己的子键，又补一发 `channelKeys.all`。由于 `.all`
 * 是这些子键的前缀，前一发完全被后一发覆盖，等于只有广播生效。
 *
 * 建模依据：频道列表（ChannelAdmin）带 subscriberCount 与 messageCount，
 * 但不含菜单与自动回复，因此
 *  - 订阅者、消息类 mutation 需要连带失效列表
 *  - 菜单、自动回复类 mutation 只动自己的子键
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  channelKeys,
  useAddChannelSubscribers,
  useChannelAutoReplies,
  useChannelList,
  useChannelMenus,
  useChannelSubscribers,
  useChannelTemplates,
  useDeleteChannel,
  useSaveChannelAutoReply,
  useSaveChannelMenus,
} from './channels';

const LIST_PARAMS = { page: 1, pageSize: 10 };
const SUB_PARAMS = { page: 1, pageSize: 10 };

const CHANNEL = { id: 1, code: 'news', name: '新闻', subscriberCount: 2, messageCount: 5 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/channels/admin', { list: [CHANNEL], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/channels/1/menus', [])
    .on('GET', '/api/channels/1/auto-replies', [])
    .on('GET', '/api/channels/admin/1/subscribers', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/channels/templates', [])
    .on('PUT', '/api/channels/1/menus', [])
    .on('POST', '/api/channels/1/auto-replies', { id: 9 })
    .on('POST', '/api/channels/admin/1/subscribers', null)
    .on('DELETE', '/api/channels/1', null);
});

function mountChannelWorkbench() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      list: useChannelList(LIST_PARAMS),
      menus: useChannelMenus(1),
      autoReplies: useChannelAutoReplies(1),
      subscribers: useChannelSubscribers(1, SUB_PARAMS),
      templates: useChannelTemplates(),
      saveMenus: useSaveChannelMenus(),
      saveAutoReply: useSaveChannelAutoReply(),
      addSubscribers: useAddChannelSubscribers(),
      removeChannel: useDeleteChannel(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountChannelWorkbench>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.list.isSuccess).toBe(true);
    expect(hook.result.current.menus.isSuccess).toBe(true);
    expect(hook.result.current.autoReplies.isSuccess).toBe(true);
    expect(hook.result.current.subscribers.isSuccess).toBe(true);
    expect(hook.result.current.templates.isSuccess).toBe(true);
  });
}

describe('菜单与自动回复不出现在频道列表，故不应牵动列表', () => {
  it('saving menus refreshes only the menu query', async () => {
    const { qc, hook } = mountChannelWorkbench();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.saveMenus.mutateAsync({ params: { id: 1 }, body: { menus: [] } });
    await waitFor(() => expect(fetches.countOf(channelKeys.menus(1))).toBe(1));

    expect(fetches.countOf(channelKeys.lists)).toBe(0);
    expect(fetches.countOf(channelKeys.autoReplies(1))).toBe(0);
    expect(fetches.countOf(channelKeys.channelSubscribers(1))).toBe(0);
    expect(fetches.countOf(channelKeys.templates)).toBe(0);
    expect(isFresh(qc, channelKeys.templates)).toBe(true);

    fetches.stop();
  });

  it('saving an auto reply refreshes only the auto-reply query', async () => {
    const { qc, hook } = mountChannelWorkbench();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.saveAutoReply.mutateAsync({ channelId: 1, values: { keyword: 'hi' } });
    await waitFor(() => expect(fetches.countOf(channelKeys.autoReplies(1))).toBe(1));

    expect(fetches.countOf(channelKeys.lists)).toBe(0);
    expect(fetches.countOf(channelKeys.menus(1))).toBe(0);
    expect(api.countOf('GET', '/api/channels/admin')).toBe(0);

    fetches.stop();
  });
});

describe('订阅者变更影响列表的 subscriberCount', () => {
  it('refreshes both the subscriber list and the channel list, but not menus or templates', async () => {
    const { qc, hook } = mountChannelWorkbench();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.addSubscribers.mutateAsync({ params: { id: 1 }, body: { userIds: [7] } });
    await waitFor(() => expect(fetches.countOf(channelKeys.lists)).toBe(1));

    expect(fetches.countOf(channelKeys.channelSubscribers(1))).toBe(1);
    expect(fetches.countOf(channelKeys.menus(1))).toBe(0);
    expect(fetches.countOf(channelKeys.templates)).toBe(0);

    fetches.stop();
  });
});

describe('useDeleteChannel', () => {
  it('drops the removed channel sub-resource caches instead of leaving them to 404 refetches', async () => {
    const { qc, hook } = mountChannelWorkbench();
    await settle(hook);

    // 频道工作台切走后遗留的消息缓存：有数据、无 observer
    const messagesKey = channelKeys.messages(1, { page: 1, pageSize: 10 });
    qc.setQueryData(messagesKey, { list: [], total: 0 });
    expect(hasCacheEntry(qc, messagesKey)).toBe(true);

    await hook.result.current.removeChannel.mutateAsync([1]);
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));

    expect(hasCacheEntry(qc, messagesKey)).toBe(false);
  });
});
