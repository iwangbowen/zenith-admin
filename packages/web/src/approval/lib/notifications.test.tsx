import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inAppMessageContract } from '@zenith/shared/messaging';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { contractKey } from '@/lib/contract-query';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/contract-query', async importOriginal => ({ ...await importOriginal<object>(), api: request }));
import { approvalKeys, useApprovalNotifications, useApprovalNotificationUnreadCount, useMarkAllApprovalNotificationsRead } from './queries';
import { approvalRequest } from './approval-request';

beforeEach(() => { request.mockReset(); });
describe('approval inbox requests and cache consistency', () => {
  it('paginates the server-filtered inbox and refreshes its count after scoped mark-all', async () => {
    let read = false;
    request.mockImplementation(async (op, input, options) => {
      expect(options).toEqual({ client: approvalRequest, silent: true });
      if (op === inAppMessageContract.list) {
        expect(input.query.eventGroup).toBe('workflow');
        const start = (input.query.page - 1) * 20;
        return { list: Array.from({ length: Math.min(20, 25 - start) }, (_, i) => ({ id: start + i + 1, eventKey: 'workflow.task.created', isRead: read })), total: 25 };
      }
      if (op === inAppMessageContract.unreadCount) { expect(input).toEqual({ query: { eventGroup: 'workflow' } }); return { count: read ? 0 : 25 }; }
      if (op === inAppMessageContract.markAllRead) { expect(input).toEqual({ body: { eventGroup: 'workflow' } }); read = true; return { count: 25 }; }
      throw new Error('Unexpected operation');
    });
    const client = createTestQueryClient();
    // PC 缓存为不同形状，不能与无限列表共用同一个 key。
    client.setQueryData(contractKey(inAppMessageContract.list), { list: [{ id: 999 }], total: 1 });
    const hook = renderHook(() => ({ list: useApprovalNotifications(true), unread: useApprovalNotificationUnreadCount(), markAll: useMarkAllApprovalNotificationsRead() }), { wrapper: createWrapper(client) });
    await waitFor(() => expect(hook.result.current.list.list).toHaveLength(20));
    expect(hook.result.current.list.total).toBe(25);
    await act(async () => { await hook.result.current.list.fetchNextPage(); });
    await waitFor(() => expect(hook.result.current.list.list).toHaveLength(25));
    expect(hook.result.current.list.hasNextPage).toBe(false);
    await act(async () => { await hook.result.current.markAll.mutateAsync(); });
    await waitFor(() => expect(hook.result.current.unread.data?.count).toBe(0));
    await waitFor(() => expect(hook.result.current.list.list.every(row => row.isRead)).toBe(true));
    expect(client.getQueryData(contractKey(inAppMessageContract.list))).toEqual({ list: [{ id: 999 }], total: 1 });
    expect(approvalKeys.notificationUnread).not.toEqual(contractKey(inAppMessageContract.unreadCount));
    hook.unmount(); client.clear();
  });
});
