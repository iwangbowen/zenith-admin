import { useCallback, useEffect } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { QueryClient } from '@tanstack/react-query';
import { chatContract } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import { useWebSocket, useWsConnected } from '@/hooks/useWebSocket';
import { chatKeys } from '@/hooks/queries/chat';
import type { ChatConversation, ChatMessage, ChatReadState } from '@zenith/shared/chat';
import type { Channel } from '@zenith/shared/messaging';
import type { WsMessage } from '@zenith/shared/platform';
import { getNextMentionUnread, markConversationReadById, recallMessageById, removeConversationById, removeMessageById, setMessageReactions, setMessageVoteData, applyPresenceToLastSeen, applyPresenceToOnlineIds } from '../utils-state';
import type { GroupAvatarMap, Setter, TypingUsersMap } from '../types';

/** WebSocket 消息分发、群头像成员刷新、触底/触顶回调、断线重连兜底（自 ChatPage 原样搬移） */
export function useChatWebSocket({
  activeChannelId, activeConvId, contextMode, conversations, currentUserId, hasMore,
  loadingMsgs, oldestMsgId, pendingNewMsgCount, queryClient, restoreLatestMessages,
  fetchConversations, fetchMessages, appendMessageOnce, applyMessageUpdate,
  isAtBottomRef, virtuosoRef, wsDisconnectedSinceReadyRef, wsHasConnectedRef, setActiveConvId, setChannels,
  setConversations, setGroupAvatarMap, setLastSeenMap, setMediaItems, setMessages, setOnlineUserIds,
  setPendingNewMsgCount, setReadStates, setTypingUsers,
}: {
  activeChannelId: number | null;
  activeConvId: number | null;
  contextMode: { anchorMessageId: number; keyword: string } | null;
  conversations: ChatConversation[];
  currentUserId: number | null;
  hasMore: boolean;
  loadingMsgs: boolean;
  oldestMsgId: number | null;
  pendingNewMsgCount: number;
  queryClient: QueryClient;
  restoreLatestMessages: () => Promise<void>;
  fetchConversations: () => Promise<void>;
  fetchMessages: (convId: number, beforeId?: number) => Promise<ChatMessage[] | null>;
  appendMessageOnce: (message: ChatMessage) => void;
  applyMessageUpdate: (message: ChatMessage) => void;
  isAtBottomRef: React.RefObject<boolean>;
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  wsDisconnectedSinceReadyRef: React.RefObject<boolean>;
  wsHasConnectedRef: React.RefObject<boolean>;
  setActiveConvId: Setter<number | null>;
  setChannels: Setter<Channel[]>;
  setConversations: Setter<ChatConversation[]>;
  setGroupAvatarMap: Setter<GroupAvatarMap>;
  setLastSeenMap: Setter<Record<number, string | null>>;
  setMediaItems: Setter<ChatMessage[]>;
  setMessages: Setter<ChatMessage[]>;
  setOnlineUserIds: Setter<Set<number>>;
  setPendingNewMsgCount: Setter<number>;
  setReadStates: Setter<ChatReadState[]>;
  setTypingUsers: Setter<TypingUsersMap>;
}) {
  const refreshGroupAvatarMembers = useCallback(async (conversationId: number) => {
    const members = await api(chatContract.groupMembers, { params: { id: conversationId } }, { silent: true }).catch(() => null);
    if (!members) return;
    setGroupAvatarMap((prev) => ({
      ...prev,
      [conversationId]: members.slice(0, 9).map((m) => ({ id: m.id, nickname: m.nickname, avatar: m.avatar })),
    }));
  }, []);

  const handleWsMessage = useCallback((wsMsg: WsMessage) => {
    if (wsMsg.type === 'channel:message') {
      const m = wsMsg.payload;
      setChannels((prev) => prev.map((c) =>
        c.id === m.channelId
          ? { ...c, lastMessage: m, unreadCount: activeChannelId === m.channelId ? 0 : c.unreadCount + 1 }
          : c));
      return;
    }
    if (wsMsg.type === 'chat:message') {
      const msg = wsMsg.payload;
      // 列表中不存在的会话（他人新建的群/单聊、转发新建会话）：整体拉取会话列表
      if (!conversations.some((c) => c.id === msg.conversationId)) {
        void fetchConversations();
        return;
      }
      const isOwnMsg = msg.senderId === currentUserId;
      const mentionedMe = !isOwnMsg && (msg.extra?.mentions ?? []).some((item) => item.userId === currentUserId);
      const shouldAutoRead = msg.conversationId === activeConvId && (isOwnMsg || isAtBottomRef.current);
      if (msg.conversationId === activeConvId) {
        appendMessageOnce(msg);
        if (shouldAutoRead) {
          setTimeout(() => virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' }), 80);
          api(chatContract.markRead, { params: { id: msg.conversationId } }, { silent: true }).catch(() => {});
          setPendingNewMsgCount(0);
        } else if (!isOwnMsg) {
          setPendingNewMsgCount((v) => v + 1);
        }
      }
      setConversations((prev) => {
        const isActive = msg.conversationId === activeConvId;
        const computeUnread = (c: typeof prev[number]) => {
          if (isOwnMsg) return c.unreadCount;
          if (isActive && shouldAutoRead) return 0;
          return c.unreadCount + 1;
        };
        const updated = prev.map((c) =>
          c.id === msg.conversationId
            ? {
              ...c,
              lastMessage: msg,
              unreadCount: computeUnread(c),
              hasMentionUnread: getNextMentionUnread(c.hasMentionUnread, isOwnMsg, isActive && shouldAutoRead, mentionedMe),
              updatedAt: msg.createdAt,
            }
            : c,
        );
        const idx = updated.findIndex((c) => c.id === msg.conversationId);
        if (idx > 0) {
          const [item] = updated.splice(idx, 1);
          if (item.isPinned) {
            // 置顶会话保持在置顶区最前面
            updated.unshift(item);
          } else {
            // 非置顶会话插到第一个非置顶会话的位置（置顶会话之后）
            const firstNonPinnedIdx = updated.findIndex((c) => !c.isPinned);
            if (firstNonPinnedIdx === -1) {
              updated.push(item);
            } else {
              updated.splice(firstNonPinnedIdx, 0, item);
            }
          }
        }
        return updated;
      });
      if (mentionedMe) {
        const isConvMuted = conversations.find((c) => c.id === msg.conversationId)?.isMuted ?? false;
        // WebSocket 驱动可能短时间连发多条提醒，stack 堆叠展示防止并列刷屏
        if (!isConvMuted) Toast.info({ content: `${msg.senderName ?? '有人'} @了你`, stack: true });
      }
    } else if (wsMsg.type === 'chat:recall') {
      const { messageId } = wsMsg.payload;
      setMessages(recallMessageById(messageId));
      setMediaItems(removeMessageById(messageId));
    } else if (wsMsg.type === 'chat:edit') {
      applyMessageUpdate(wsMsg.payload);
    } else if (wsMsg.type === 'chat:reaction') {
      const { messageId, reactions } = wsMsg.payload;
      setMessages(setMessageReactions(messageId, reactions));
    } else if (wsMsg.type === 'chat:vote-update') {
      const { messageId, voteData } = wsMsg.payload;
      setMessages(setMessageVoteData(messageId, voteData));
    } else if (wsMsg.type === 'chat:typing') {
      const { conversationId, userId, nickname } = wsMsg.payload;
      if (conversationId !== activeConvId || userId === currentUserId) return;
      const removeTypingUser = (id: number) => (p: TypingUsersMap) => {
        const next = { ...p };
        delete next[id];
        return next;
      };
      setTypingUsers((prev) => {
        const existing = prev[userId];
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => setTypingUsers(removeTypingUser(userId)), 4000);
        return { ...prev, [userId]: { nickname, timer } };
      });
    } else if (wsMsg.type === 'chat:member-join') {
      void refreshGroupAvatarMembers(wsMsg.payload.conversationId);
      void queryClient.invalidateQueries({ queryKey: chatKeys.groupMembers(wsMsg.payload.conversationId) });
      if (wsMsg.payload.conversationId === activeConvId) {
        void fetchConversations();
      }
    } else if (wsMsg.type === 'chat:member-leave') {
      const { conversationId, userId } = wsMsg.payload;
      if (userId === currentUserId) {
        setConversations(removeConversationById(conversationId));
        if (activeConvId === conversationId) {
          setActiveConvId(null);
          setMessages([]);
        }
        Toast.warning('你已被移出该群聊');
      } else {
        void refreshGroupAvatarMembers(conversationId);
        void queryClient.invalidateQueries({ queryKey: chatKeys.groupMembers(conversationId) });
      }
    } else if (wsMsg.type === 'chat:conversation-removed') {
      const { conversationId } = wsMsg.payload;
      setConversations(removeConversationById(conversationId));
      if (activeConvId === conversationId) {
        setActiveConvId(null);
        setMessages([]);
      }
      Toast.warning('该群聊已被群主解散');
    } else if (wsMsg.type === 'chat:group-update') {
      const { conversationId, name, announcement, muteAll, joinApproval } = wsMsg.payload;
      setConversations((prev) =>
        prev.map((c) => c.id === conversationId
          ? {
            ...c,
            ...(name === undefined ? {} : { name }),
            ...(announcement === undefined ? {} : { announcement }),
            ...(muteAll === undefined ? {} : { muteAll }),
            ...(joinApproval === undefined ? {} : { joinApproval }),
          }
          : c),
      );
    } else if (wsMsg.type === 'chat:member-update') {
      // 角色/禁言/审批处理变更：刷新会话列表（myRole/myMutedUntil）、成员面板与入群申请列表
      void fetchConversations();
      void queryClient.invalidateQueries({ queryKey: chatKeys.groupMembers(wsMsg.payload.conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.joinRequests(wsMsg.payload.conversationId) });
    } else if (wsMsg.type === 'chat:join-request') {
      void queryClient.invalidateQueries({ queryKey: chatKeys.joinRequests(wsMsg.payload.conversationId) });
      Toast.info('收到新的入群申请，可在群信息面板中审批');
    } else if (wsMsg.type === 'chat:read') {
      const { conversationId, userId, readAt } = wsMsg.payload;
      if (conversationId !== activeConvId || userId === currentUserId) return;
      setReadStates((prev) => prev.map((s) => (s.userId === userId ? { ...s, lastReadAt: readAt } : s)));
    } else if (wsMsg.type === 'chat:presence') {
      setOnlineUserIds(applyPresenceToOnlineIds(wsMsg.payload));
      setLastSeenMap(applyPresenceToLastSeen(wsMsg.payload));
    }
  }, [activeChannelId, activeConvId, appendMessageOnce, applyMessageUpdate, conversations, currentUserId, fetchConversations, queryClient, refreshGroupAvatarMembers]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    if (!atBottom || !activeConvId) return;
    // 在上下文定位模式下滚动到底部时，自动恢复最新消息
    if (contextMode) {
      void restoreLatestMessages();
      return;
    }
    if (pendingNewMsgCount > 0) setPendingNewMsgCount(0);
    api(chatContract.markRead, { params: { id: activeConvId } }, { silent: true }).catch(() => {});
    setConversations(markConversationReadById(activeConvId));
  }, [activeConvId, contextMode, pendingNewMsgCount, restoreLatestMessages]);

  const handleStartReached = useCallback(() => {
    if (!hasMore || loadingMsgs || !activeConvId) return;
    void fetchMessages(activeConvId, oldestMsgId ?? undefined);
  }, [activeConvId, fetchMessages, hasMore, loadingMsgs, oldestMsgId]);

  useWebSocket(handleWsMessage);
  const wsConnected = useWsConnected();

  // WebSocket 断线重连成功后，主动补拉会话列表与当前会话最新消息，避免断线期间漏消息。
  useEffect(() => {
    if (!wsConnected) {
      if (wsHasConnectedRef.current) wsDisconnectedSinceReadyRef.current = true;
      return;
    }

    if (!wsHasConnectedRef.current) {
      wsHasConnectedRef.current = true;
      return;
    }

    if (!wsDisconnectedSinceReadyRef.current) return;
    wsDisconnectedSinceReadyRef.current = false;

    const shouldStickToBottom = isAtBottomRef.current;
    void (async () => {
      await fetchConversations();

      if (activeConvId && !contextMode) {
        await fetchMessages(activeConvId);
        if (shouldStickToBottom) {
          requestAnimationFrame(() => virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' }));
          api(chatContract.markRead, { params: { id: activeConvId } }, { silent: true }).catch(() => {});
          setConversations(markConversationReadById(activeConvId));
        }
      }

      Toast.success('实时连接已恢复，已同步最新消息');
    })();
  }, [activeConvId, contextMode, fetchConversations, fetchMessages, wsConnected]);

  return { refreshGroupAvatarMembers, handleAtBottomStateChange, handleStartReached, wsConnected };
}
