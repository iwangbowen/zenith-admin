import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { chatContract } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import { confirmDelete } from '@/utils/confirm';
import { useChatAnnouncementHistory, useDeleteChatAnnouncementHistory } from '@/hooks/queries/chat';
import type { ChatConversation, ChatMessage, ChatMessageContext, ChatGroupMember, ChatReadState } from '@zenith/shared/chat';
import type { MessageReadReceipt, Setter } from '../types';
import { applyPresenceToLastSeen, applyPresenceToOnlineIds } from '../utils-state';

const EMPTY_ANNOUNCEMENT_HISTORY: ChatMessage[] = [];

/** 会话附属数据：置顶/收藏消息、群公告历史、已读回执、在线状态（自 ChatPage 原样搬移） */
export function useConversationExtras({
  activeConvId, announcementHistoryVisible, activeConv, activeGroupMembers, currentUserId, conversations,
  readStates, setPinnedMessages, setFavoriteMessages, setLeftPaneMode, setActiveConvId, setMessages,
  setHasMore, setOldestMsgId, setContextMode, setReadStates, setOnlineUserIds, setLastSeenMap,
}: {
  activeConvId: number | null;
  announcementHistoryVisible: boolean;
  activeConv: ChatConversation | null;
  activeGroupMembers: ChatGroupMember[];
  currentUserId: number | null;
  conversations: ChatConversation[];
  readStates: ChatReadState[];
  setPinnedMessages: Setter<ChatMessage[]>;
  setFavoriteMessages: Setter<ChatMessage[]>;
  setLeftPaneMode: Setter<'conversations' | 'favorites' | 'globalSearch'>;
  setActiveConvId: Setter<number | null>;
  setMessages: Setter<ChatMessage[]>;
  setHasMore: Setter<boolean>;
  setOldestMsgId: Setter<number | null>;
  setContextMode: Setter<{ anchorMessageId: number; keyword: string } | null>;
  setReadStates: Setter<ChatReadState[]>;
  setOnlineUserIds: Setter<Set<number>>;
  setLastSeenMap: Setter<Record<number, string | null>>;
}) {
  // 响应归属校验：快速切换会话时，先发出的旧会话请求可能后返回，
  // 若不校验会用旧会话的置顶/已读数据覆盖当前会话状态
  const activeConvIdRef = useRef(activeConvId);
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  const fetchPinnedMessages = useCallback(async (convId: number) => {
    const list = await api(chatContract.pinnedMessages, { params: { id: convId } }, { silent: true }).catch(() => null);
    if (convId !== activeConvIdRef.current) return;
    if (list) setPinnedMessages(list);
  }, []);

  const fetchFavoriteMessages = useCallback(async () => {
    const page = await api(chatContract.globalFavoriteMessages, { query: { page: 1, pageSize: 100 } }, { silent: true }).catch(() => null);
    if (page) setFavoriteMessages(page.list);
  }, []);

  // 群公告历史是抽屉打开时才需要的非实时数据，交给 Query 持有：
  // 删除后由 mutation 失效，无需在页面里手工维护数组
  const announcementHistoryQuery = useChatAnnouncementHistory(
    activeConvId ?? undefined,
    announcementHistoryVisible,
  );
  const announcementHistory = announcementHistoryQuery.data ?? EMPTY_ANNOUNCEMENT_HISTORY;
  const deleteAnnouncementHistoryMutation = useDeleteChatAnnouncementHistory();

  const isOwnerOfActiveGroup = useMemo(() => {
    if (!currentUserId || activeConv?.type !== 'group') return false;
    return activeGroupMembers.some((m) => m.id === currentUserId && m.role === 'owner');
  }, [activeConv?.type, activeGroupMembers, currentUserId]);

  const handleDeleteAnnouncementHistory = useCallback((messageId: number) => {
    if (!activeConvId) return;
    confirmDelete({
      title: '删除公告历史',
      content: '确定要删除该条公告历史记录吗？此操作不可恢复。',
      onOk: async () => {
        await deleteAnnouncementHistoryMutation.mutateAsync({ params: { id: activeConvId, messageId } });
        Toast.success('已删除');
      },
    });
  }, [activeConvId, deleteAnnouncementHistoryMutation]);

  const openFavoriteMessage = useCallback(async (message: ChatMessage) => {
    let context: ChatMessageContext;
    try {
      context = await api(chatContract.messageContext, {
        params: { id: message.conversationId, messageId: message.id },
        query: { before: 15, after: 15 },
      }, { silent: true });
    } catch (err) {
      Toast.error(err instanceof Error && err.message ? err.message : '定位收藏消息失败');
      return;
    }
    setLeftPaneMode('conversations');
    setActiveConvId(message.conversationId);
    setMessages(context.list);
    setHasMore(context.hasBefore);
    setOldestMsgId(context.list[0]?.id ?? null);
    setContextMode({ anchorMessageId: context.anchorMessageId, keyword: '收藏消息' });
    const anchorMessageId = context.anchorMessageId;
    setTimeout(() => {
      const el = document.getElementById(`msg-${anchorMessageId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s ease';
      el.style.background = 'var(--semi-color-primary-light-hover)';
      setTimeout(() => { el.style.background = ''; }, 1200);
    }, 80);
  }, []);

  const fetchReadStates = useCallback(async (convId: number) => {
    const states = await api(chatContract.readStates, { params: { id: convId } }, { silent: true }).catch(() => null);
    if (convId !== activeConvIdRef.current) return;
    if (states) setReadStates(states);
  }, []);

  const fetchPresence = useCallback(async (userIds: number[]) => {
    const ids = [...new Set(userIds)].filter((id) => id > 0);
    if (ids.length === 0) return;
    const presence = await api(chatContract.presence, { query: { userIds: ids.join(',') } }, { silent: true }).catch(() => null);
    if (!presence) return;
    setOnlineUserIds(applyPresenceToOnlineIds(presence));
    setLastSeenMap(applyPresenceToLastSeen(presence));
  }, []);

  useEffect(() => {
    if (!activeConvId) {
      setPinnedMessages([]);
      setReadStates([]);
      return;
    }
    void fetchPinnedMessages(activeConvId);
    void fetchReadStates(activeConvId);
  }, [activeConvId, fetchPinnedMessages, fetchReadStates]);

  // 拉取相关用户在线状态：单聊对方 + 当前群成员
  useEffect(() => {
    const directIds = conversations
      .filter((c) => c.type === 'direct' && c.targetUser)
      .map((c) => c.targetUser!.id);
    const groupIds = activeGroupMembers.map((m) => m.id);
    void fetchPresence([...directIds, ...groupIds]);
  }, [conversations, activeGroupMembers, fetchPresence]);

  // 计算单条消息的已读回执（仅对自己发送的消息）
  const computeReadReceipt = useCallback((msg: ChatMessage): MessageReadReceipt | undefined => {
    if (!activeConv || msg.senderId !== currentUserId) return undefined;
    if (msg.isRecalled || msg.type === 'system') return undefined;
    const isRead = (s: ChatReadState) => !!s.lastReadAt && s.lastReadAt >= msg.createdAt;
    if (activeConv.type === 'direct') {
      const other = readStates[0];
      return { kind: 'direct', read: other ? isRead(other) : false };
    }
    const readers = readStates.filter(isRead);
    const unreaders = readStates.filter((s) => !isRead(s));
    return {
      kind: 'group',
      readCount: readers.length,
      total: readStates.length,
      readers: readers.map((s) => ({ nickname: s.nickname, avatar: s.avatar })),
      unreaders: unreaders.map((s) => ({ nickname: s.nickname, avatar: s.avatar })),
    };
  }, [activeConv, currentUserId, readStates]);

  return {
    fetchPinnedMessages, fetchFavoriteMessages, announcementHistory, isOwnerOfActiveGroup, handleDeleteAnnouncementHistory, openFavoriteMessage,
    fetchReadStates, fetchPresence, computeReadReceipt,
  };
}
