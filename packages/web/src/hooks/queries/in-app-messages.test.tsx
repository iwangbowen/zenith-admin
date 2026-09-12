/**
 * in-app-messages / inbox 缓存一致性契约
 *
 * 收敛前管理端写操作 `invalidateQueries({ queryKey: inAppMessageKeys.all })`，把发送弹窗里的模板下拉源一并打掉；
 * 收件箱页则另起 `['inbox']` 根键，与顶栏铃铛（同一个 `list` 操作）各存一份互不相干的缓存。
 *
 * 契约 key 下两者天然同源：`contractKey(inAppMessageContract.list)` 同时覆盖铃铛的首页 10 条与收件箱的任意分页。
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
  inAppMessageKeys,
  useEnabledInAppTemplates,
  useInAppMessageList,
  useMyInAppMessageUnreadCount,
  useMyInAppMessages,
  useSendInAppMessage,
} from './in-app-messages';
import { inboxKeys, useDeleteInboxMessage, useInboxList, useMarkInboxMessageRead } from './inbox';

const ADMIN_PARAMS = { page: 1, pageSize: 10 };
const INBOX_PARAMS = { page: 1, pageSize: 20, isRead: false };
const MESSAGE = { id: 1, title: '系统通知', content: '正文', isRead: false, createdAt: '2026-08-01 10:00:00' };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/in-app-messages/admin', { list: [MESSAGE], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/in-app-messages', { list: [MESSAGE], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/in-app-messages/unread-count', { count: 1 })
    .on('GET', '/api/in-app-templates', { list: [{ id: 1, name: '模板' }], total: 1, page: 1, pageSize: 100 })
    .on('POST', '/api/in-app-messages/send', { sent: 1 })
    .on('POST', '/api/in-app-messages/1/read', null)
    .on('DELETE', '/api/in-app-messages/1', null);
});

describe('管理端发送', () => {
  it('refreshes the admin list, the bell list and the unread badge, but leaves the template lookup fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        admin: useInAppMessageList(ADMIN_PARAMS),
        bell: useMyInAppMessages(),
        unread: useMyInAppMessageUnreadCount(),
        templates: useEnabledInAppTemplates(true),
        send: useSendInAppMessage(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.admin.isSuccess).toBe(true);
      expect(result.current.bell.isSuccess).toBe(true);
      expect(result.current.unread.isSuccess).toBe(true);
      expect(result.current.templates.isSuccess).toBe(true);
    });
    expect(result.current.bell.data).toEqual([MESSAGE]);
    expect(result.current.unread.data).toBe(1);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.send.mutateAsync({ body: { userIds: [7], title: '通知', content: '正文' } });
    await waitFor(() => {
      expect(fetches.countOf(inAppMessageKeys.lists)).toBe(1);
      expect(fetches.countOf(inAppMessageKeys.mine)).toBe(1);
      expect(fetches.countOf(inAppMessageKeys.myUnreadCount)).toBe(1);
    });

    // 发送弹窗此刻仍打开，模板下拉源是活跃查询；收敛前会被 `.all` 打回源
    expect(fetches.countOf(inAppMessageKeys.enabledTemplates)).toBe(0);
    expect(api.countOf('GET', '/api/in-app-templates')).toBe(0);
    expect(isFresh(qc, inAppMessageKeys.enabledTemplates)).toBe(true);

    fetches.stop();
  });
});

describe('收件箱与顶栏铃铛同源', () => {
  it('marking a message read from the inbox also refreshes the bell list and badge', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        inbox: useInboxList(INBOX_PARAMS),
        bell: useMyInAppMessages(),
        unread: useMyInAppMessageUnreadCount(),
        admin: useInAppMessageList(ADMIN_PARAMS),
        markRead: useMarkInboxMessageRead(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.inbox.isSuccess).toBe(true);
      expect(result.current.bell.isSuccess).toBe(true);
      expect(result.current.unread.isSuccess).toBe(true);
      expect(result.current.admin.isSuccess).toBe(true);
    });
    // 同一个 list 操作，两个分页各一份缓存但同属 `inboxKeys.lists` 前缀
    expect(hasCacheEntry(qc, inboxKeys.list(INBOX_PARAMS))).toBe(true);
    expect(hasCacheEntry(qc, inAppMessageKeys.mine)).toBe(true);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.markRead.mutateAsync({ params: { id: 1 } });
    await waitFor(() => {
      expect(fetches.countOf(inboxKeys.list(INBOX_PARAMS))).toBe(1);
      expect(fetches.countOf(inAppMessageKeys.mine)).toBe(1);
      expect(fetches.countOf(inAppMessageKeys.myUnreadCount)).toBe(1);
    });

    // 本人已读不改变管理端的收件记录视图
    expect(fetches.countOf(inAppMessageKeys.lists)).toBe(0);
    expect(api.countOf('GET', '/api/in-app-messages/admin')).toBe(0);

    fetches.stop();
  });

  it('drops the deleted message detail instead of refetching it into a 404', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ inbox: useInboxList(INBOX_PARAMS), remove: useDeleteInboxMessage() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.inbox.isSuccess).toBe(true));

    qc.setQueryData(inboxKeys.detail(1), MESSAGE);
    api.resetCalls();

    await result.current.remove.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(result.current.inbox.isFetching).toBe(false));

    expect(hasCacheEntry(qc, inboxKeys.detail(1))).toBe(false);
    expect(api.countOf('GET', '/api/in-app-messages/1')).toBe(0);
  });
});
