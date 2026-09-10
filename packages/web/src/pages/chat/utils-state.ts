import type { ChatConversation, ChatGroupMember, ChatMessage, ChatPresence, ChatVoteData } from '@zenith/shared/chat';
import type { Channel } from '@zenith/shared/messaging';
import type { FailedMessage, LeftListItem } from './types';
import { getAssetMeta } from './utils';

// Virtuoso 中支持 prepend（向前加载历史消息）需要预留的虚拟 index 起点
export const VIRTUOSO_FIRST_INDEX_BUFFER = 10000;

export function getNextMentionUnread(
  current: boolean | undefined,
  isOwnMsg: boolean,
  shouldAutoRead: boolean,
  mentionedMe: boolean,
) {
  if (isOwnMsg) return current ?? false;
  if (shouldAutoRead) return false;
  return Boolean(current || mentionedMe);
}

// 模块级 state updater 工厂，避免组件内函数嵌套超过 4 层
export const removeMessageById = (id: number) => (prev: ChatMessage[]) => prev.filter((m) => m.id !== id);
export const removeUploadingItemById = (id: string) => (prev: import('./types').UploadingItem[]) => prev.filter((u) => u.id !== id);
export const updateUploadingProgress = (id: string, percent: number) =>
  (prev: import('./types').UploadingItem[]) => prev.map((u) => (u.id === id ? { ...u, progress: percent } : u));
export function makeProgressHandler(
  id: string,
  setItems: React.Dispatch<React.SetStateAction<import('./types').UploadingItem[]>>,
) {
  return (percent: number) => { setItems(updateUploadingProgress(id, percent)); };
}

export const getReplyPreviewText = (m: ChatMessage): string => {
  if (m.type === 'image') return '[图片]';
  if (m.type === 'file') return `[文件] ${getAssetMeta(m)?.name ?? ''}`;
  if (m.type === 'voice') return '[语音]';
  if (m.type === 'card') return `[卡片] ${m.extra?.card?.title ?? ''}`.trim();
  return m.content;
};
export const removeMessagesByIds = (ids: Set<number>) => (prev: ChatMessage[]) => prev.filter((m) => !ids.has(m.id));
export const setMessageReactions = (messageId: number, reactions: ChatMessage['reactions']) =>
  (prev: ChatMessage[]) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m));
export const recallMessageById = (messageId: number) =>
  (prev: ChatMessage[]) => prev.map((m) => (m.id === messageId ? { ...m, isRecalled: true, content: '消息已撤回' } : m));
export const setMessageVoteData = (messageId: number, voteData: ChatVoteData) =>
  (prev: ChatMessage[]) => prev.map((m) => (m.id === messageId ? { ...m, extra: { ...m.extra, voteData } } : m));

export const removeConversationById = (convId: number) => (prev: ChatConversation[]) => prev.filter((c) => c.id !== convId);
export const markConversationReadById = (convId: number) =>
  (prev: ChatConversation[]) => prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0, hasMentionUnread: false } : c));
export const sortConversations = (a: ChatConversation, b: ChatConversation) => {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  const ta = a.lastMessage?.createdAt ?? a.createdAt;
  const tb = b.lastMessage?.createdAt ?? b.createdAt;
  return tb.localeCompare(ta);
};
export const togglePinAndSort = (convId: number, isPinned: boolean) => (prev: ChatConversation[]) => {
  const updated = prev.map((c) => (c.id === convId ? { ...c, isPinned: !isPinned } : c));
  updated.sort(sortConversations);
  return updated;
};
export const toggleConvStarred = (convId: number, isStarred: boolean) =>
  (prev: ChatConversation[]) => prev.map((c) => (c.id === convId ? { ...c, isStarred: !isStarred } : c));
export const toggleConvMuted = (convId: number, isMuted: boolean) =>
  (prev: ChatConversation[]) => prev.map((c) => (c.id === convId ? { ...c, isMuted: !isMuted } : c));

export const removeFailedMessageById = (id: string) =>
  (prev: FailedMessage[]) => prev.filter((m) => m.id !== id);

/** 卡片消息本地置为已处理（工作流审批完成后更新卡片状态文案） */
export const markCardDoneLocal = (messageId: number, statusText: string) =>
  (prev: ChatMessage[]) => prev.map((m) =>
    m.id === messageId && m.extra?.card
      ? { ...m, extra: { ...m.extra, card: { ...m.extra.card, status: 'done' as const, statusText } } }
      : m);

/** 在线/最近在线文案：lastSeen 为 'YYYY-MM-DD HH:mm:ss' */
export function formatPresenceText(online: boolean, lastSeen: string | null | undefined): string {
  if (online) return '在线';
  if (!lastSeen) return '离线';
  return `最近在线 ${lastSeen.slice(5, 16)}`;
}

// 批量在线状态合并进本地 state（WS 推送与 GET /api/chat/presence 快照共用同一份逻辑）
export const applyPresenceToOnlineIds = (changes: ChatPresence[]) => (prev: Set<number>) => {
  const next = new Set(prev);
  for (const p of changes) {
    if (p.online) next.add(p.userId);
    else next.delete(p.userId);
  }
  return next;
};
export const applyPresenceToLastSeen = (changes: ChatPresence[]) => (prev: Record<number, string | null>) => {
  const next = { ...prev };
  for (const p of changes) next[p.userId] = p.lastSeen;
  return next;
};

/** 左栏列表派生数据（纯函数）：搜索过滤 + 归档分组 + 频道/会话混排 */
export function computeLeftListModel({ conversations, channels, convSearch, showArchived }: {
  conversations: ChatConversation[];
  channels: Channel[];
  convSearch: string;
  showArchived: boolean;
}) {
  const filteredConvs = conversations.filter((c) => {
    if (!convSearch) return true;
    const name = c.type === 'direct' ? (c.targetUser?.nickname ?? '') : (c.name ?? '');
    return name.toLowerCase().includes(convSearch.toLowerCase());
  });

  // 归档分组：搜索时跨归档全量匹配；平时归档会话收进折叠组
  const archivedConvs = filteredConvs.filter((c) => c.isArchived ?? false);
  const archivedUnread = archivedConvs.reduce((s, c) => s + c.unreadCount, 0);
  const visibleConvs = convSearch
    ? filteredConvs
    : filteredConvs.filter((c) => (showArchived ? (c.isArchived ?? false) : !(c.isArchived ?? false)));
  const showArchiveToggle = !convSearch && (archivedConvs.length > 0 || showArchived);

  // 仿微信：频道与会话合并为同一个列表，按最后消息时间倒序排列（置顶会话优先），不再将频道单独置顶
  const filteredChannels = convSearch
    ? channels.filter((ch) => ch.name.toLowerCase().includes(convSearch.toLowerCase()))
    : (showArchived ? [] : channels);
  const parseMsgTime = (s?: string | null) => (s ? new Date(s.replace(' ', 'T')).getTime() : 0);
  const leftListItems: LeftListItem[] = [
    ...filteredChannels.map((ch): LeftListItem => ({ kind: 'channel', sortTime: parseMsgTime(ch.lastMessage?.createdAt), pinned: false, channel: ch })),
    ...visibleConvs.map((conv): LeftListItem => ({ kind: 'conv', sortTime: parseMsgTime(conv.lastMessage?.createdAt ?? conv.updatedAt), pinned: conv.isPinned ?? false, conv })),
  ].sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.sortTime - a.sortTime));

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  return { filteredConvs, archivedConvs, archivedUnread, visibleConvs, showArchiveToggle, filteredChannels, leftListItems, totalUnread };
}

/** 根容器样式（quick / page 两种形态） */
export function getRootStyle(isQuick: boolean): React.CSSProperties {
  return isQuick
    ? {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      background: 'var(--semi-color-bg-1)',
    }
    : {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 500,
      overflow: 'hidden',
    };
}

/** 组合输入框 keydown 处理器工厂：@提及弹层导航 + Enter 发送 */
export function createComposerKeyDownHandler({
  mentionState, mentionClosed, mentionCandidates, mentionActiveIndex,
  setMentionActiveIndex, mentionListRef, insertMention, setMentionClosed, handleSend,
}: {
  mentionState: { start: number; end: number; query: string } | null;
  mentionClosed: boolean;
  mentionCandidates: ChatGroupMember[];
  mentionActiveIndex: number;
  setMentionActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  mentionListRef: React.RefObject<HTMLDivElement | null>;
  insertMention: (member: ChatGroupMember) => void;
  setMentionClosed: React.Dispatch<React.SetStateAction<boolean>>;
  handleSend: () => Promise<void>;
}) {
  return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const popupOpen = !!(mentionState && !mentionClosed && mentionCandidates.length > 0);
    if (popupOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActiveIndex((i) => {
          const next = (i + 1) % mentionCandidates.length;
          // 滚动到可见区
          requestAnimationFrame(() => {
            const el = mentionListRef.current?.children[next] as HTMLElement | undefined;
            el?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActiveIndex((i) => {
          const next = (i - 1 + mentionCandidates.length) % mentionCandidates.length;
          requestAnimationFrame(() => {
            const el = mentionListRef.current?.children[next] as HTMLElement | undefined;
            el?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const candidate = mentionCandidates[mentionActiveIndex];
        if (candidate) insertMention(candidate);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionClosed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };
}
