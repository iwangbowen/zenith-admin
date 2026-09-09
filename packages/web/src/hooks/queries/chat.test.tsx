/**
 * chat 域群成员缓存归一（S7 首个切片）
 *
 * 背景：ChatPage 曾把群成员镜像成本地 useState，只在切换会话时手工拉一次；
 * 而 GroupMembersPanel 用的是 `useChatGroupMembers`（Query 缓存）。同一份服务端
 * 状态存在两份副本，成员相关 mutation 只会刷新面板那份，页面那份保持陈旧。
 *
 * 后果不止于列表显示：ChatPage 用它算 @提及候选、**群主判定（决定操作权限）**
 * 与在线状态拉取名单，转让群主后页面仍按旧数据判断。
 *
 * 这些用例锁定「单一数据源」这一修复：成员类 mutation 之后，任何读取
 * `chatKeys.groupMembers(convId)` 的消费方都必须拿到同一份最新数据。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ChatConversation, ChatGroupMember } from '@zenith/shared/chat';
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
  chatKeys,
  useAddChatGroupMember,
  useChatAnnouncementHistory,
  useChatCustomEmojis,
  useChatGroupMembers,
  useChatQuickReplies,
  useChatUnreadCount,
  useChatUsers,
  useConversations,
  useDeleteChatAnnouncementHistory,
  useSetChatMemberRole,
  useTransferChatGroupOwner,
  useUpdateChatGroupInfo,
} from './chat';
import { useChatBotGroupConversations } from './chat-bots';

const OWNER_ALICE: ChatGroupMember[] = [
  { id: 1, nickname: '爱丽丝', role: 'owner' } as ChatGroupMember,
  { id: 2, nickname: '鲍勃', role: 'member' } as ChatGroupMember,
];

const OWNER_BOB: ChatGroupMember[] = [
  { id: 1, nickname: '爱丽丝', role: 'member' } as ChatGroupMember,
  { id: 2, nickname: '鲍勃', role: 'owner' } as ChatGroupMember,
];

const CONVERSATIONS: ChatConversation[] = [
  { id: 1, type: 'group', name: '研发群', unreadCount: 3, isMuted: false } as ChatConversation,
  { id: 2, type: 'direct', name: null, unreadCount: 2, isMuted: true } as ChatConversation,
  { id: 3, type: 'group', name: '公告群', unreadCount: 0, isMuted: false } as ChatConversation,
];

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/chat/conversations', CONVERSATIONS)
    .on('GET', '/api/chat/conversations/10/members', OWNER_ALICE)
    .on('GET', '/api/chat/quick-replies', [{ id: 1, content: '收到' }])
    .on('GET', '/api/chat/custom-emojis', [{ id: 1, url: 'a.png' }])
    .on('GET', '/api/chat/users', [{ id: 1, nickname: '爱丽丝' }])
    .on('POST', '/api/chat/conversations/10/members', null)
    .on('POST', '/api/chat/conversations/10/transfer', null)
    .on('PATCH', '/api/chat/conversations/10/members/2/role', null)
    .on('PATCH', '/api/chat/conversations/10/group-info', null)
    .on('GET', '/api/chat/conversations/10/announcement-history', [{ id: 100, content: '旧公告' }])
    .on('DELETE', '/api/chat/conversations/10/announcement-history/100', null);
});

describe('群成员单一数据源', () => {
  it('serves the page and the members panel from one cache entry, so both refresh together', async () => {
    const qc = createTestQueryClient();
    // 两个消费方模拟 ChatPage 与 GroupMembersPanel 同时读取
    const { result } = renderHook(
      () => ({
        page: useChatGroupMembers(10, true),
        panel: useChatGroupMembers(10, true),
        addMember: useAddChatGroupMember(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.page.isSuccess).toBe(true);
      expect(result.current.panel.isSuccess).toBe(true);
    });

    // 共用一个 key，因此只发一次请求
    expect(api.countOf('GET', '/api/chat/conversations/10/members')).toBe(1);

    const fetches = observeFetches(qc);
    api.on('GET', '/api/chat/conversations/10/members', [
      ...OWNER_ALICE,
      { id: 3, nickname: '查理', role: 'member' } as ChatGroupMember,
    ]);

    await result.current.addMember.mutateAsync({ params: { id: 10 }, body: { userId: 3 } });
    await waitFor(() => expect(fetches.countOf(chatKeys.groupMembers(10))).toBe(1));
    await waitFor(() => expect(result.current.page.data).toHaveLength(3));

    // 关键：两个消费方拿到的是同一份最新数据，不存在一方陈旧
    expect(result.current.page.data).toEqual(result.current.panel.data);

    fetches.stop();
  });

  it('propagates an ownership transfer to the page, which derives operator permissions from it', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ page: useChatGroupMembers(10, true), transfer: useTransferChatGroupOwner() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.page.isSuccess).toBe(true));

    const isOwner = (members: ChatGroupMember[] | undefined, userId: number) =>
      (members ?? []).some((m) => m.id === userId && m.role === 'owner');
    expect(isOwner(result.current.page.data, 1)).toBe(true);

    api.on('GET', '/api/chat/conversations/10/members', OWNER_BOB);
    await result.current.transfer.mutateAsync({ params: { id: 10 }, body: { newOwnerId: 2 } });

    await waitFor(() => expect(isOwner(result.current.page.data, 2)).toBe(true));
    // 转让后原群主不应仍被判定为群主（此前页面副本不刷新，会继续放行群主操作）
    expect(isOwner(result.current.page.data, 1)).toBe(false);
    expect(getCacheEntry<ChatGroupMember[]>(qc, chatKeys.groupMembers(10))).toEqual(OWNER_BOB);
  });

  it('does not fetch members for a direct conversation', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useChatGroupMembers(10, false), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(api.countOf('GET', '/api/chat/conversations/10/members')).toBe(0);
    expect(result.current.data).toBeUndefined();
  });
});

describe('成员类 mutation 不再牵动同根静态 lookup', () => {
  it('leaves quick replies, custom emojis and the user lookup untouched', async () => {
    const qc = createTestQueryClient();
    // ChatPage 上这三个 lookup 长期挂载，收敛前每次成员变更都被 chatKeys.all 打回源
    const { result } = renderHook(
      () => ({
        members: useChatGroupMembers(10, true),
        quickReplies: useChatQuickReplies(),
        emojis: useChatCustomEmojis(),
        users: useChatUsers({}),
        addMember: useAddChatGroupMember(),
        setRole: useSetChatMemberRole(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.members.isSuccess).toBe(true);
      expect(result.current.quickReplies.isSuccess).toBe(true);
      expect(result.current.emojis.isSuccess).toBe(true);
      expect(result.current.users.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.addMember.mutateAsync({ params: { id: 10 }, body: { userId: 3 } });
    await result.current.setRole.mutateAsync({ params: { id: 10, userId: 2 }, body: { role: 'admin' } });
    await waitFor(() => expect(fetches.countOf(chatKeys.groupMembers(10))).toBe(2));

    expect(api.countOf('GET', '/api/chat/quick-replies')).toBe(0);
    expect(api.countOf('GET', '/api/chat/custom-emojis')).toBe(0);
    expect(api.countOf('GET', '/api/chat/users')).toBe(0);
    expect(isFresh(qc, chatKeys.quickReplies)).toBe(true);
    expect(isFresh(qc, chatKeys.customEmojis)).toBe(true);

    fetches.stop();
  });
});

describe('会话级 key 与成员 key 解耦', () => {  it('refreshing conversations no longer wipes every conversation member roster', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ members: useChatGroupMembers(10, true), updateInfo: useUpdateChatGroupInfo() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.members.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    // 改群名/公告只是会话字段；此前成员 key 嵌在 conversations 之下，会被前缀连坐
    await result.current.updateInfo.mutateAsync({ params: { id: 10 }, body: { name: '新群名' } });

    expect(fetches.countOf(chatKeys.groupMembers(10))).toBe(0);
    expect(api.countOf('GET', '/api/chat/conversations/10/members')).toBe(0);
    expect(isFresh(qc, chatKeys.groupMembers(10))).toBe(true);

    fetches.stop();
  });
});

describe('群公告历史迁入 Query（S11）', () => {
  it('only fetches when the drawer is open, and refreshes itself after a delete', async () => {
    const qc = createTestQueryClient();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => ({
        history: useChatAnnouncementHistory(10, open),
        remove: useDeleteChatAnnouncementHistory(),
      }),
      { wrapper: createWrapper(qc), initialProps: { open: false } },
    );

    // 抽屉未打开：不应产生请求
    await waitFor(() => expect(result.current.history.isFetching).toBe(false));
    expect(api.countOf('GET', '/api/chat/conversations/10/announcement-history')).toBe(0);

    rerender({ open: true });
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
    expect(result.current.history.data).toHaveLength(1);

    const fetches = observeFetches(qc);
    api.on('GET', '/api/chat/conversations/10/announcement-history', []);

    await result.current.remove.mutateAsync({ params: { id: 10, messageId: 100 } });
    await waitFor(() => expect(result.current.history.data).toHaveLength(0));

    // 删除后由 mutation 失效重拉，页面不再手工维护数组
    expect(fetches.countOf(chatKeys.announcementHistory(10))).toBe(1);
    expect(fetches.countOf(chatKeys.groupMembers(10))).toBe(0);

    fetches.stop();
  });
});

describe('会话列表：壳层消费方共用一份缓存', () => {
  it('serves the unread badge, the notifier list and the bot group picker from one request', async () => {
    const qc = createTestQueryClient();
    // 模拟 AdminLayout 同时挂载的三类消费方：顶栏未读徽标 / 通知器（useConversations）/ 机器人表单群聊下拉
    const { result } = renderHook(
      () => ({
        unread: useChatUnreadCount(),
        list: useConversations(),
        groups: useChatBotGroupConversations(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.unread.isSuccess).toBe(true);
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.groups.isSuccess).toBe(true);
    });

    // 此前三处各自请求（其中通知器还每 60s 轮询一次）；现在共用 chatKeys.conversations，只发一次
    expect(api.countOf('GET', '/api/chat/conversations')).toBe(1);
    expect(result.current.unread.data).toBe(5);
    expect(result.current.list.data).toEqual(CONVERSATIONS);
    expect(result.current.groups.data?.map((c) => c.id)).toEqual([1, 3]);
    expect(getCacheEntry<ChatConversation[]>(qc, chatKeys.conversations)).toEqual(CONVERSATIONS);
  });

  it('keeps the WebSocket-maintained badge writable and lets the mute toggle patch the shared list without refetching', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ unread: useChatUnreadCount(), list: useConversations() }),
      { wrapper: createWrapper(qc) },
    );
    // 与真实组件一样读取 data（v5 只对渲染期访问过的属性变化重渲染）
    await waitFor(() => {
      expect(result.current.list.data).toEqual(CONVERSATIONS);
      expect(result.current.unread.data).toBe(5);
    });
    api.resetCalls();

    // useLayoutWs 收到 chat:message 时 +1；进入 /chat 时置 0——两者都直接写 unreadCount 缓存
    qc.setQueryData<number>(chatKeys.unreadCount, (prev) => (prev ?? 0) + 1);
    await waitFor(() => expect(result.current.unread.data).toBe(6));

    // 聊天页切换免打扰后写回共享列表：通知器立即看到新集合，且不产生任何请求
    qc.setQueryData<ChatConversation[]>(chatKeys.conversations, (prev) =>
      prev?.map((c) => (c.id === 1 ? { ...c, isMuted: true } : c)));
    await waitFor(() => expect(result.current.list.data?.find((c) => c.id === 1)?.isMuted).toBe(true));
    expect(api.countOf('GET', '/api/chat/conversations')).toBe(0);
    expect(isFresh(qc, chatKeys.conversations)).toBe(true);
  });
});