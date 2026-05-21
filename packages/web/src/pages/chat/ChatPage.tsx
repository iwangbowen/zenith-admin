import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Input, Button, Badge, Typography, Empty, Spin, Toast, Tooltip, Modal, Tag, Select, DatePicker, Dropdown, ImagePreview, Popover,
  List as SemiList,
} from '@douyinfe/semi-ui';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

// Virtuoso 中支持 prepend（向前加载历史消息）需要预留的虚拟 index 起点
const VIRTUOSO_FIRST_INDEX_BUFFER = 10000;
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import {
  Search, MessageSquarePlus, Send, CornerDownLeft, RotateCcw, Smile, ImagePlus, MoreHorizontal,
  Pin, PinOff, Star, X, Paperclip, Bookmark, History, Forward, Trash2, BellOff, Images, AlertCircle,
  ArrowLeft, ExternalLink, BarChart3, MessageSquare,
} from 'lucide-react';
import { useWebSocket, sendWsMessage, useWsConnected } from '@/hooks/useWebSocket';
import { useAuth } from '@/hooks/useAuth';
import { request } from '@/utils/request';
import { formatDateTime, formatConvTime, formatDateTimeForApi } from '@/utils/date';
import { formatFileSize, getFileTypeIcon, fetchProtectedFile } from '@/utils/file-utils';
import type {
  ChatConversation, ChatMessage, WsMessage, ChatLinkPreview, ChatAssetMeta, ChatMessageExtra,
  ChatGroupMember, ChatMessageSearchItem, ChatMessageSearchResult, ChatMessageContext, ChatVoteData,
} from '@zenith/shared';
import {
  extractFirstUrl, getFileExtension, getAssetMeta, getMessageSummary, shouldDisplayMessageTime,
  getImageDimensions,
} from './utils';
import type { ChatUser, PendingImage, PendingFile, SearchDatePreset, FailedMessage } from './types';
import { CHAT_MESSAGE_TYPE_OPTIONS } from './types';
import { UserAvatar, GroupGridAvatar } from './components/UserAvatar';
import { NewChatPanel } from './components/NewChatPanel';
import { GroupMembersPanel } from './components/GroupMembersPanel';
import { ForwardModal } from './components/ForwardModal';
import { ForwardedMessagesModal } from './components/ForwardedMessagesModal';
import { VotePollModal } from './components/VotePollModal';
import { MessageBubble } from './components/MessageBubble';

import { MessageContent } from './components/MessageContent';

const { Text, Title } = Typography;

function getNextMentionUnread(
  current: boolean | undefined,
  isOwnMsg: boolean,
  shouldAutoRead: boolean,
  mentionedMe: boolean,
) {
  if (isOwnMsg) return current ?? false;
  if (shouldAutoRead) return false;
  return Boolean(current || mentionedMe);
}

export interface ChatPageProps {
  variant?: 'page' | 'quick';
  onClose?: () => void;
  onOpenFullPage?: (convId?: number | null) => void;
  onUnreadChange?: (count: number) => void;
  onConvChange?: (convId: number | null) => void;
}

export default function ChatPage({
  variant = 'page',
  onClose,
  onOpenFullPage,
  onUnreadChange,
  onConvChange,
}: Readonly<ChatPageProps> = {}) {
  const isQuick = variant === 'quick';
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mentionClosed, setMentionClosed] = useState(false);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiVisible, setEmojiVisible] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<{ top: number; left: number } | null>(null);

  const [reactionPickerVisible, setReactionPickerVisible] = useState(false);
  const [reactionPickerAnchor, setReactionPickerAnchor] = useState<{ top: number; right: number } | null>(null);
  const [reactionTargetMsgId, setReactionTargetMsgId] = useState<number | null>(null);
  const [convSearch, setConvSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [oldestMsgId, setOldestMsgId] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pendingNewMsgCount, setPendingNewMsgCount] = useState(0);
  const [msgSearch, setMsgSearch] = useState('');
  const [searchTypeFilters, setSearchTypeFilters] = useState<ChatMessage['type'][]>([]);
  const [searchSenderId, setSearchSenderId] = useState<number | undefined>();
  const [searchTimeRange, setSearchTimeRange] = useState<[Date, Date] | null>(null);
  const [searchDatePreset, setSearchDatePreset] = useState<SearchDatePreset>('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ChatMessageSearchItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasSearched, setSearchHasSearched] = useState(false);
  const [searchMembers, setSearchMembers] = useState<ChatGroupMember[]>([]);
  const [groupAvatarMap, setGroupAvatarMap] = useState<Record<number, Array<{ id: number; nickname: string; avatar?: string | null }>>>({});
  const [activeGroupMembers, setActiveGroupMembers] = useState<ChatGroupMember[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<Array<{ userId: number; nickname: string }>>([]);
  const [leftPaneMode, setLeftPaneMode] = useState<'conversations' | 'favorites' | 'globalSearch'>('conversations');
  const [globalSearchKeyword, setGlobalSearchKeyword] = useState('');
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState<import('@zenith/shared').ChatMessageSearchItem[]>([]);
  const [globalSearchTotal, setGlobalSearchTotal] = useState(0);
  const [globalSearchPage, setGlobalSearchPage] = useState(1);
  const [globalSearchHasSearched, setGlobalSearchHasSearched] = useState(false);
  const [globalSearchConvNames, setGlobalSearchConvNames] = useState<Record<string, string>>({});
  const [favoriteMessages, setFavoriteMessages] = useState<ChatMessage[]>([]);
  const [leftPaneContextMenu, setLeftPaneContextMenu] = useState<
    | { x: number; y: number; type: 'conversation'; conv: ChatConversation }
    | { x: number; y: number; type: 'favorite'; msg: ChatMessage }
    | null
  >(null);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [announcementHistoryVisible, setAnnouncementHistoryVisible] = useState(false);
  const [announcementHistory, setAnnouncementHistory] = useState<ChatMessage[]>([]);
  const [recalledDrafts, setRecalledDrafts] = useState<Record<number, { content: string; mentions?: Array<{ userId: number; nickname: string }> }>>({});
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const [forwardModalVisible, setForwardModalVisible] = useState(false);
  const [forwardingMessageIds, setForwardingMessageIds] = useState<number[]>([]);
  const [forwardingMode, setForwardingMode] = useState<'merge' | 'individual'>('individual');
  const [forwardViewVisible, setForwardViewVisible] = useState(false);
  const [forwardViewItems, setForwardViewItems] = useState<NonNullable<ChatMessageExtra['forwardedMessages']>>([]);
  const [forwardViewTitle, setForwardViewTitle] = useState('');
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [favPreviewVisible, setFavPreviewVisible] = useState(false);
  const [favPreviewMsg, setFavPreviewMsg] = useState<ChatMessage | null>(null);
  const [contextMode, setContextMode] = useState<{ anchorMessageId: number; keyword: string } | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<number, { nickname: string; timer: ReturnType<typeof setTimeout> }>>({});
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [failedMessages, setFailedMessages] = useState<FailedMessage[]>([]);
  const [draftsMap, setDraftsMap] = useState<Record<number, string>>({});
  const [showMediaPanel, setShowMediaPanel] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'file' | 'link'>('image');
  const [mediaItems, setMediaItems] = useState<ChatMessage[]>([]);
  const [mediaPage, setMediaPage] = useState(1);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSrcList, setPreviewSrcList] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const previewSessionRef = useRef(0);
  const previewBlobUrlsRef = useRef<string[]>([]);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isAtBottomRef = useRef(true);
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_FIRST_INDEX_BUFFER);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAttachRef = useRef<HTMLInputElement>(null);
  const emojiContainerRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  const wsHasConnectedRef = useRef(false);
  const wsDisconnectedSinceReadyRef = useRef(false);

  // 点击 emoji 选择器外部时关闭
  useEffect(() => {
    if (!emojiVisible) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inButton = emojiContainerRef.current?.contains(target);
      const inPicker = emojiPickerRef.current?.contains(target);
      if (!inButton && !inPicker) setEmojiVisible(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emojiVisible]);

  // 点击 reaction picker 外部时关闭
  useEffect(() => {
    if (!reactionPickerVisible) return;
    const handler = (e: MouseEvent) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setReactionPickerVisible(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [reactionPickerVisible]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => () => {
    pendingImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const currentUserNickname = authUser?.nickname ?? authUser?.username ?? '我';

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const mentionState = useMemo(() => {
    if (!activeConv || activeConv.type !== 'group') return null;
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const prefix = input.slice(0, cursor);
    const atIndex = prefix.lastIndexOf('@');
    if (atIndex < 0) return null;
    if (atIndex > 0 && !/[\s\n]/.test(prefix[atIndex - 1] ?? '')) return null;
    const query = prefix.slice(atIndex + 1);
    if (query.includes(' ') || query.includes('\n')) return null;
    return { start: atIndex, end: cursor, query };
  }, [activeConv, input]);

  const ALL_MEMBERS_VIRTUAL: ChatGroupMember = { id: -1, nickname: '全体成员', username: 'all', role: 'member' };

  const mentionCandidates = useMemo(() => {
    if (!mentionState) return [];
    const kw = mentionState.query.trim().toLowerCase();
    const members = activeGroupMembers.filter((member) => {
      if (member.id === currentUserId) return false;
      if (!kw) return true;
      return member.nickname.toLowerCase().includes(kw) || member.username.toLowerCase().includes(kw);
    }).slice(0, 7);
    // 在群聊中支持 @全体成员
    if (activeConv?.type === 'group') {
      const allMatches = !kw || '全体成员'.includes(kw) || 'all'.includes(kw);
      if (allMatches) return [ALL_MEMBERS_VIRTUAL, ...members];
    }
    return members;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.type, activeGroupMembers, currentUserId, mentionState]);

  const fetchConversations = useCallback(async () => {
    setLoadingConvs(true);
    const res = await request.get<ChatConversation[]>('/api/chat/conversations', { silent: true });
    setLoadingConvs(false);
    if (res.code === 0 && res.data) setConversations(res.data);
  }, []);

  useEffect(() => { void fetchConversations(); }, [fetchConversations]);

  // 初始化时从 localStorage 加载所有草稿
  useEffect(() => {
    try {
      const raw = localStorage.getItem('zenith_chat_drafts');
      if (raw) {
        const drafts = JSON.parse(raw) as Record<string, string>;
        const map: Record<number, string> = {};
        for (const [k, v] of Object.entries(drafts)) {
          if (v.trim()) map[Number(k)] = v;
        }
        setDraftsMap(map);
      }
    } catch { /* ignore */ }
  }, []);

  // 用户正在输入时，实时更新当前会话的草稿 map（不写 localStorage，仅更新 state）
  useEffect(() => {
    if (!activeConvId) return;
    setDraftsMap((prev) => {
      if (input.trim()) return { ...prev, [activeConvId]: input };
      const next = { ...prev };
      delete next[activeConvId];
      return next;
    });
  }, [activeConvId, input]);

  // 读取 URL ?conv= 参数，在会话列表加载后自动激活对应会话
  useEffect(() => {
    if (isQuick) return;
    const convParam = searchParams.get('conv');
    if (!convParam) return;
    const convId = Number(convParam);
    if (!Number.isFinite(convId) || convId <= 0) return;
    if (conversations.length === 0) return; // 等列表加载完再处理
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return;
    setSearchParams((prev) => { prev.delete('conv'); return prev; }, { replace: true });
    void handleSelectConv(conv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, isQuick]);

  const cleanupPreviewBlobs = useCallback(() => {
    previewBlobUrlsRef.current.forEach((u) => { if (u) URL.revokeObjectURL(u); });
    previewBlobUrlsRef.current = [];
  }, []);

  const openImagePreview = useCallback(async (clickedMsg: ChatMessage, allImgs: ChatMessage[]) => {
    const session = ++previewSessionRef.current;
    const clickedIndex = allImgs.findIndex((m) => m.id === clickedMsg.id);
    if (clickedIndex < 0) return;
    cleanupPreviewBlobs();
    try {
      const clickedBlob = await fetchProtectedFile(clickedMsg.content);
      if (previewSessionRef.current !== session) return;
      const clickedUrl = URL.createObjectURL(clickedBlob);
      previewBlobUrlsRef.current[clickedIndex] = clickedUrl;
      const initialUrls = allImgs.map((_, i) => (i === clickedIndex ? clickedUrl : ''));
      setPreviewSrcList([...initialUrls]);
      setPreviewCurrentIndex(clickedIndex);
      setPreviewVisible(true);
      // 后台加载其余图片
      for (const [i, imgMsg] of allImgs.entries()) {
        if (i === clickedIndex) continue;
        try {
          const blob = await fetchProtectedFile(imgMsg.content);
          if (previewSessionRef.current !== session) break;
          const url = URL.createObjectURL(blob);
          previewBlobUrlsRef.current[i] = url;
          setPreviewSrcList((prev) => { const copy = [...prev]; copy[i] = url; return copy; });
        } catch { /* skip failed */ }
      }
    } catch { Toast.error('图片加载失败'); }
  }, [cleanupPreviewBlobs]);

  const fetchPinnedMessages = useCallback(async (convId: number) => {
    const res = await request.get<ChatMessage[]>(`/api/chat/conversations/${convId}/pinned-messages`, { silent: true });
    if (res.code === 0 && res.data) setPinnedMessages(res.data);
  }, []);

  const fetchFavoriteMessages = useCallback(async () => {
    const res = await request.get<{ list: ChatMessage[] }>(`/api/chat/favorite-messages?page=1&pageSize=100`, { silent: true });
    if (res.code === 0 && res.data) setFavoriteMessages(res.data.list);
  }, []);

  const fetchAnnouncementHistory = useCallback(async (convId: number) => {
    const res = await request.get<ChatMessage[]>(`/api/chat/conversations/${convId}/announcement-history`, { silent: true });
    if (res.code === 0 && res.data) setAnnouncementHistory(res.data);
  }, []);

  const isOwnerOfActiveGroup = useMemo(() => {
    if (!currentUserId || activeConv?.type !== 'group') return false;
    return activeGroupMembers.some((m) => m.id === currentUserId && m.role === 'owner');
  }, [activeConv?.type, activeGroupMembers, currentUserId]);

  const handleDeleteAnnouncementHistory = useCallback((messageId: number) => {
    if (!activeConvId) return;
    Modal.confirm({
      title: '删除公告历史',
      content: '确定要删除该条公告历史记录吗？此操作不可恢复。',
      okType: 'danger',
      onOk: async () => {
        const res = await request.delete(`/api/chat/conversations/${activeConvId}/announcement-history/${messageId}`);
        if ((res as { code: number }).code === 0) {
          Toast.success('已删除');
          setAnnouncementHistory((prev) => prev.filter((it) => it.id !== messageId));
        } else {
          Toast.error((res as { message?: string }).message ?? '删除失败');
        }
      },
    });
  }, [activeConvId]);

  const openFavoriteMessage = useCallback(async (message: ChatMessage) => {
    const res = await request.get<ChatMessageContext>(
      `/api/chat/conversations/${message.conversationId}/messages/${message.id}/context?before=15&after=15`,
      { silent: true },
    );
    if (res.code !== 0 || !res.data) {
      Toast.error(res.message ?? '定位收藏消息失败');
      return;
    }
    setLeftPaneMode('conversations');
    setActiveConvId(message.conversationId);
    setMessages(res.data.list);
    setHasMore(res.data.hasBefore);
    setOldestMsgId(res.data.list[0]?.id ?? null);
    setContextMode({ anchorMessageId: res.data.anchorMessageId, keyword: '收藏消息' });
    setTimeout(() => {
      const el = document.getElementById(`msg-${res.data!.anchorMessageId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s ease';
      el.style.background = 'var(--semi-color-primary-light-hover)';
      setTimeout(() => { el.style.background = ''; }, 1200);
    }, 80);
  }, []);

  useEffect(() => {
    if (!activeConvId) {
      setActiveGroupMembers([]);
      setPinnedMessages([]);
      return;
    }
    void fetchPinnedMessages(activeConvId);
    if (activeConv?.type === 'group') {
      void request.get<ChatGroupMember[]>(`/api/chat/conversations/${activeConvId}/members`, { silent: true }).then((res) => {
        if (res.code === 0 && res.data) setActiveGroupMembers(res.data);
      });
    } else {
      setActiveGroupMembers([]);
    }
  }, [activeConv?.type, activeConvId, fetchPinnedMessages]);

  useEffect(() => {
    if (leftPaneMode === 'favorites') {
      void fetchFavoriteMessages();
    }
  }, [fetchFavoriteMessages, leftPaneMode]);

  const fetchMessages = useCallback(async (convId: number, beforeId?: number) => {
    setLoadingMsgs(true);
    const qs = beforeId ? `beforeId=${beforeId}&limit=30` : 'limit=30';
    const res = await request.get<{ list: ChatMessage[]; hasMore: boolean }>(
      `/api/chat/conversations/${convId}/messages?${qs}`,
      { silent: true },
    );
    setLoadingMsgs(false);
    if (res.code === 0 && res.data) {
      const newMsgs = [...res.data.list].reverse(); // backend returns newest-first, reverse to oldest-first
      if (beforeId) {
        setMessages((prev) => [...newMsgs, ...prev]);
        setOldestMsgId(newMsgs[0]?.id ?? null);
        // Virtuoso 通过 firstItemIndex 向前偏移来保持当前视口位置不跳动
        setFirstItemIndex((prev) => prev - newMsgs.length);
      } else {
        setMessages(newMsgs);
        setOldestMsgId(newMsgs[0]?.id ?? null);
        setPendingNewMsgCount(0);
        setContextMode(null);
        setFirstItemIndex(VIRTUOSO_FIRST_INDEX_BUFFER);
      }
      setHasMore(res.data.hasMore);
    }
  }, []);

  const DRAFT_STORAGE_KEY = 'zenith_chat_drafts';

  const saveDraft = useCallback((convId: number, text: string) => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      const drafts: Record<string, string> = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      if (text.trim()) {
        drafts[String(convId)] = text;
      } else {
        delete drafts[String(convId)];
      }
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
      setDraftsMap((prev) => {
        if (text.trim()) return { ...prev, [convId]: text };
        const next = { ...prev };
        delete next[convId];
        return next;
      });
    } catch { /* ignore */ }
  }, []);

  const loadDraft = useCallback((convId: number): string => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return '';
      const drafts = JSON.parse(raw) as Record<string, string>;
      return drafts[String(convId)] ?? '';
    } catch {
      return '';
    }
  }, []);

  const handleSelectConv = useCallback(async (conv: ChatConversation) => {
    // 保存当前会话草稿
    if (activeConvId) saveDraft(activeConvId, input);
    setActiveConvId(conv.id);
    onConvChange?.(conv.id);
    setReplyTo(null);
    setSelectedMentions([]);
    setPendingImages([]);
    setPendingFiles([]);
    setLeftPaneMode('conversations');
    setAnnouncementHistoryVisible(false);
    setShowMembers(false);
    setShowSearchPanel(false);
    setMsgSearch('');
    setSearchTypeFilters([]);
    setSearchSenderId(undefined);
    setSearchTimeRange(null);
    setSearchDatePreset('');
    setSearchResults([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchHasSearched(false);
    setContextMode(null);
    setShowMediaPanel(false);
    setMediaItems([]);
    setMediaPage(1);
    setMediaHasMore(false);
    // 恢复目标会话草稿
    setInput(loadDraft(conv.id));
    await fetchMessages(conv.id);
    await request.post(`/api/chat/conversations/${conv.id}/read`, {}, { silent: true });
    setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, unreadCount: 0, hasMentionUnread: false } : c));
    setTimeout(() => virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' }), 100);
  }, [activeConvId, fetchMessages, input, loadDraft, onConvChange, saveDraft]);

  const handleNewDirectChat = useCallback(async (user: ChatUser) => {
    setShowNewChat(false);
    const res = await request.post<ChatConversation>('/api/chat/conversations/direct', { targetUserId: user.id });
    if (res.code === 0 && res.data) {
      await fetchConversations();
      await handleSelectConv(res.data);
    }
  }, [fetchConversations, handleSelectConv]);

  const handleGroupCreated = useCallback(async (conv: ChatConversation) => {
    setShowNewChat(false);
    await fetchConversations();
    await handleSelectConv(conv);
  }, [fetchConversations, handleSelectConv]);

  const appendMessageOnce = useCallback((message: ChatMessage) => {
    setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
  }, []);

  const sendFileMessage = useCallback(async (file: File) => {
    if (!activeConvId) return false;
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await request.postForm<{ url: string; originalName: string; size: number }>('/api/files/upload-one', fd);
    if (uploadRes.code !== 0 || !uploadRes.data) return false;
    const { url, originalName, size } = uploadRes.data;
    const asset: ChatAssetMeta = {
      kind: 'file',
      name: originalName,
      size,
      mimeType: file.type || null,
      extension: getFileExtension(originalName),
    };
    const msgRes = await request.post<ChatMessage>(`/api/chat/conversations/${activeConvId}/messages`, {
      content: url,
      type: 'file',
      extra: { asset },
    });
    if (msgRes.code === 0 && msgRes.data) appendMessageOnce(msgRes.data);
    return msgRes.code === 0;
  }, [activeConvId, appendMessageOnce]);

  const handleTyping = useCallback((newValue: string) => {
    if (!activeConvId || !currentUserId || !newValue.trim()) return;
    if (typingThrottleRef.current) return;
    sendWsMessage({ type: 'chat:typing', payload: { conversationId: activeConvId, userId: currentUserId, nickname: currentUserNickname } });
    typingThrottleRef.current = setTimeout(() => { typingThrottleRef.current = null; }, 3000);
  }, [activeConvId, currentUserId, currentUserNickname]);

  const sendImageFile = useCallback(async (file: File) => {
    if (!activeConvId) return false;
    const dimensions = await getImageDimensions(file);
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await request.postForm<{ url: string; originalName: string; size: number }>(
      '/api/files/upload-one', fd,
    );
    if (uploadRes.code !== 0 || !uploadRes.data) {
      return false;
    }
    const { url, originalName, size } = uploadRes.data;
    const asset: ChatAssetMeta = {
      kind: 'image',
      name: originalName,
      size,
      mimeType: file.type || null,
      extension: getFileExtension(originalName),
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      thumbnailUrl: url,
    };
    const msgRes = await request.post<ChatMessage>(`/api/chat/conversations/${activeConvId}/messages`, {
      content: url,
      type: 'image',
      extra: { asset },
    });
    if (msgRes.code === 0 && msgRes.data) appendMessageOnce(msgRes.data);
    return msgRes.code === 0;
  }, [activeConvId, appendMessageOnce]);

  const fetchLinkPreview = useCallback(async (url: string): Promise<ChatLinkPreview | null> => {
    const res = await request.get<ChatLinkPreview>(`/api/chat/link-preview?url=${encodeURIComponent(url)}`, { silent: true });
    if (res.code === 0 && res.data) return res.data;
    return null;
  }, []);

  const handleSend = useCallback(async () => {
    if (!activeConvId || sending || (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0)) return;

    const content = input.trim();
    const imagesToSend = [...pendingImages];
    const filesToSend = [...pendingFiles];

    setInput('');
    // 清除该会话草稿
    saveDraft(activeConvId, '');
    setDraftsMap((prev) => { const next = { ...prev }; delete next[activeConvId]; return next; });
    setPendingImages([]);
    setPendingFiles([]);
    imagesToSend.forEach((item) => URL.revokeObjectURL(item.previewUrl));

    setSending(true);
    if (imagesToSend.length > 0 || filesToSend.length > 0) setUploading(true);

    let failedImageCount = 0;
    let failedFileCount = 0;

    if (content) {
      const body: Record<string, unknown> = { content, type: 'text' };
      if (replyTo) body.replyToId = replyTo.id;
      const mentions = selectedMentions.filter((item) => content.includes(`@${item.nickname}`));
      const extra: Record<string, unknown> = mentions.length > 0 ? { mentions } : {};
      const firstUrl = extractFirstUrl(content);
      if (firstUrl) {
        const preview = await fetchLinkPreview(firstUrl);
        if (preview) extra.linkPreview = preview;
      }
      if (Object.keys(extra).length > 0) body.extra = extra;
      const res = await request.post<ChatMessage>(`/api/chat/conversations/${activeConvId}/messages`, body);
      if (res.code !== 0) {
        const failId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setFailedMessages((prev) => [...prev, { id: failId, convId: activeConvId, content }]);
      } else if (res.data) {
        appendMessageOnce(res.data);
      }
    }

    if (imagesToSend.length > 0) {
      for (const item of imagesToSend) {
        const ok = await sendImageFile(item.file);
        if (!ok) failedImageCount += 1;
      }
    }

    if (filesToSend.length > 0) {
      for (const item of filesToSend) {
        const ok = await sendFileMessage(item.file);
        if (!ok) failedFileCount += 1;
      }
    }

    setReplyTo(null);
    setSelectedMentions([]);
    setUploading(false);
    setSending(false);

    if (failedImageCount > 0) {
      Toast.error(`有 ${failedImageCount} 张图片发送失败`);
    }
    if (failedFileCount > 0) {
      Toast.error(`有 ${failedFileCount} 个文件发送失败`);
    }
  }, [activeConvId, appendMessageOnce, fetchLinkPreview, input, pendingFiles, pendingImages, replyTo, saveDraft, selectedMentions, sendFileMessage, sendImageFile, sending]);

  const handleSelectImages = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => file.type.startsWith('image/'));
    if (validFiles.length === 0) return;

    const added = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPendingImages((prev) => [...prev, ...added]);
  }, []);

  const handleSelectFile = useCallback((files: File[]) => {
    const nonImageFiles = files.filter((file) => !file.type.startsWith('image/'));
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));

    if (nonImageFiles.length === 0 && imageFiles.length > 0) {
      Toast.info('图片请使用“选择图片”按钮发送');
      return;
    }

    if (nonImageFiles.length > 0) {
      const added = nonImageFiles.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
      }));
      setPendingFiles((prev) => [...prev, ...added]);
    }
  }, []);

  const handleRemovePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const handleRemovePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleInputPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length > 0) {
      e.preventDefault();
      handleSelectImages(imageFiles);
      Toast.success(`已添加 ${imageFiles.length} 张图片`);
    }
  }, [handleSelectImages]);

  const triggerHighlight = useCallback((id: number) => {
    setHighlightedMessageId(id);
    setTimeout(() => {
      setHighlightedMessageId((curr) => (curr === id ? null : curr));
    }, 1200);
  }, []);

  const scrollToMessage = useCallback(async (id: number) => {
    // 优先查看消息是否在当前加载的 messages 中
    const idx = messages.findIndex((m) => m.id === id);
    if (idx !== -1) {
      virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + idx, align: 'center', behavior: 'smooth' });
      triggerHighlight(id);
      return;
    }
    // 消息不在当前加载范围内，调用 context 接口加载后再定位
    if (!activeConvId) return;
    const res = await request.get<ChatMessageContext>(
      `/api/chat/conversations/${activeConvId}/messages/${id}/context?before=15&after=15`,
      { silent: true },
    );
    if (res.code !== 0 || !res.data) {
      Toast.error(res.message ?? '定位消息失败');
      return;
    }
    setMessages(res.data.list);
    setHasMore(res.data.hasBefore);
    setOldestMsgId(res.data.list[0]?.id ?? null);
    setFirstItemIndex(VIRTUOSO_FIRST_INDEX_BUFFER);
    const anchorId = res.data.anchorMessageId;
    setContextMode({ anchorMessageId: anchorId, keyword: '' });
    setTimeout(() => {
      const anchorIdx = res.data?.list.findIndex((m) => m.id === anchorId) ?? -1;
      if (anchorIdx !== -1) {
        virtuosoRef.current?.scrollToIndex({
          index: VIRTUOSO_FIRST_INDEX_BUFFER + anchorIdx,
          align: 'center',
          behavior: 'smooth',
        });
        triggerHighlight(anchorId);
      }
    }, 80);
  }, [activeConvId, firstItemIndex, messages, triggerHighlight]);

  const getReplyMessage = useCallback((id: number) => messages.find((m) => m.id === id), [messages]);

  const insertMention = useCallback((member: ChatGroupMember) => {
    if (!mentionState) return;
    const mentionText = `@${member.nickname} `;
    setInput((prev) => prev.slice(0, mentionState.start) + mentionText + prev.slice(mentionState.end));
    setMentionClosed(true);
    // 全体成员虚拟条目：记录所有真实成员为 mention
    if (member.id === -1) {
      setSelectedMentions(activeGroupMembers
        .filter((m) => m.id !== currentUserId)
        .map((m) => ({ userId: m.id, nickname: m.nickname })));
    } else {
      setSelectedMentions((prev) => prev.some((item) => item.userId === member.id)
        ? prev
        : [...prev, { userId: member.id, nickname: member.nickname }]);
    }
    requestAnimationFrame(() => {
      const nextPos = mentionState.start + mentionText.length;
      inputRef.current?.setSelectionRange(nextPos, nextPos);
      inputRef.current?.focus();
    });
  }, [activeGroupMembers, currentUserId, mentionState]);

  const applyMessageUpdate = useCallback((updated: ChatMessage) => {
    setMessages((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    setPinnedMessages((prev) => {
      const next = prev.filter((item) => item.id !== updated.id);
      if (updated.extra?.isPinned) next.unshift(updated);
      return next.slice(0, 5);
    });
    setFavoriteMessages((prev) => {
      const next = prev.filter((item) => item.id !== updated.id);
      if (updated.extra?.isFavorited) next.unshift(updated);
      return next;
    });
    setConversations((prev) => prev.map((conv) => conv.lastMessage?.id === updated.id ? { ...conv, lastMessage: updated } : conv));
  }, []);

  const handleToggleFavorite = useCallback(async (msg: ChatMessage) => {
    const res = await request.patch<ChatMessage>(`/api/chat/messages/${msg.id}/favorite`, { favorite: !msg.extra?.isFavorited });
    if (res.code === 0 && res.data) {
      applyMessageUpdate(res.data);
      Toast.success(res.data.extra?.isFavorited ? '已收藏' : '已取消收藏');
      return;
    }
    Toast.error(res.message ?? '操作失败');
  }, [applyMessageUpdate]);

  const handleTogglePinMessage = useCallback(async (msg: ChatMessage) => {
    const res = await request.patch<ChatMessage>(`/api/chat/messages/${msg.id}/pin`, { pin: !msg.extra?.isPinned });
    if (res.code === 0 && res.data) {
      applyMessageUpdate(res.data);
      Toast.success(res.data.extra?.isPinned ? '已置顶消息' : '已取消置顶');
      return;
    }
    Toast.error(res.message ?? '操作失败');
  }, [applyMessageUpdate]);

  const handleEditRecalled = useCallback((messageId: number) => {
    const draft = recalledDrafts[messageId];
    if (!draft) return;
    setInput(draft.content);
    setSelectedMentions(draft.mentions ?? []);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [recalledDrafts]);

  const handleToggleSelectMessage = useCallback((msg: ChatMessage) => {
    if (msg.isRecalled || msg.type === 'system') return;
    setMultiSelectMode(true);
    setSelectedMessageIds((prev) =>
      prev.includes(msg.id) ? prev.filter((id) => id !== msg.id) : [...prev, msg.id],
    );
  }, []);

  const handleExitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedMessageIds([]);
  }, []);

  const handleForwardSingle = useCallback((msg: ChatMessage) => {
    setForwardingMode('individual');
    setForwardingMessageIds([msg.id]);
    setForwardModalVisible(true);
  }, []);

  const handleForwardSelected = useCallback((mode: 'merge' | 'individual') => {
    if (selectedMessageIds.length === 0) return;
    setForwardingMode(mode);
    setForwardingMessageIds([...selectedMessageIds]);
    setForwardModalVisible(true);
  }, [selectedMessageIds]);

  const handleForwardConfirm = useCallback(async (targetIds: number[]) => {
    setForwardModalVisible(false);
    const res = await request.post('/api/chat/messages/forward', {
      messageIds: forwardingMessageIds,
      targetConversationIds: targetIds,
      mode: forwardingMode,
    });
    if ((res as { code: number }).code === 0) {
      Toast.success('转发成功');
      handleExitMultiSelect();
    } else {
      Toast.error((res as { message?: string }).message ?? '转发失败');
    }
    setForwardingMessageIds([]);
  }, [forwardingMessageIds, forwardingMode, handleExitMultiSelect]);

  const handleFavoriteSelected = useCallback(async () => {
    if (selectedMessageIds.length === 0) return;
    const msgs = messages.filter((m) => selectedMessageIds.includes(m.id) && !m.extra?.isFavorited && !m.isRecalled && m.type !== 'system');
    if (msgs.length === 0) { Toast.info('所选消息已全部收藏'); return; }
    let successCount = 0;
    for (const msg of msgs) {
      const res = await request.patch<ChatMessage>(`/api/chat/messages/${msg.id}/favorite`, { favorite: true });
      if (res.code === 0 && res.data) {
        applyMessageUpdate(res.data);
        successCount += 1;
      }
    }
    Toast.success(`已收藏 ${successCount} 条消息`);
    handleExitMultiSelect();
  }, [selectedMessageIds, messages, applyMessageUpdate, handleExitMultiSelect]);

  const handleOpenForwardView = useCallback((items: NonNullable<ChatMessageExtra['forwardedMessages']>, title: string) => {
    setForwardViewItems(items);
    setForwardViewTitle(title);
    setForwardViewVisible(true);
  }, []);

  const handleDeleteSingle = useCallback((msg: ChatMessage) => {
    Modal.confirm({
      title: '删除这条消息？',
      content: '删除后仅对自己隐藏，不影响其他人。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      okText: '删除',
      onOk: async () => {
        const res = await request.post('/api/chat/messages/batch-delete', { messageIds: [msg.id] });
        if ((res as { code: number }).code === 0) {
          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
          Toast.success('已删除');
        } else {
          Toast.error((res as { message?: string }).message ?? '删除失败');
        }
      },
    });
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedMessageIds.length === 0) return;
    Modal.confirm({
      title: `删除已选的 ${selectedMessageIds.length} 条消息？`,
      content: '删除后仅对自己隐藏，不影响其他人。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      okText: '删除',
      onOk: async () => {
        const res = await request.post('/api/chat/messages/batch-delete', { messageIds: selectedMessageIds });
        if ((res as { code: number }).code === 0) {
          const deletedIds = new Set(selectedMessageIds);
          setMessages((prev) => prev.filter((m) => !deletedIds.has(m.id)));
          Toast.success('已删除');
          handleExitMultiSelect();
        } else {
          Toast.error((res as { message?: string }).message ?? '删除失败');
        }
      },
    });
  }, [selectedMessageIds, handleExitMultiSelect]);

  const handleReaction = useCallback((messageId: number, emoji: string) => {
    void request.post<import('@zenith/shared').ChatReactionGroup[]>(
      `/api/chat/messages/${messageId}/reactions`,
      { emoji },
    ).then((res) => {
      if (res.code === 0) {
        setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: res.data ?? [] } : m));
      }
    });
  }, []);

  const handlePickReactionEmoji = useCallback((messageId: number, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setReactionTargetMsgId(messageId);
    setReactionPickerAnchor({ top: rect.top, right: window.innerWidth - rect.right });
    setReactionPickerVisible(true);
  }, []);

  const handleCreateVote = useCallback(async (voteData: ChatVoteData, question: string) => {
    if (!activeConvId) return;
    const res = await request.post<ChatMessage>(`/api/chat/conversations/${activeConvId}/messages`, {
      content: question,
      type: 'vote',
      extra: { voteData },
    });
    if (res.code === 0 && res.data) {
      appendMessageOnce(res.data);
      setShowVoteModal(false);
      return;
    }
    Toast.error(res.message ?? '发起投票失败');
  }, [activeConvId, appendMessageOnce]);

  const handleVoteMessage = useCallback(async (msg: ChatMessage, optionIds: string[]) => {
    const res = await request.post<ChatMessage>(`/api/chat/messages/${msg.id}/vote`, { optionIds });
    if (res.code === 0 && res.data) {
      applyMessageUpdate(res.data);
      return;
    }
    Toast.error(res.message ?? '投票失败');
  }, [applyMessageUpdate]);

  // 编辑消息（由 MessageBubble 内联编辑回调）
  // ─── 消息编辑 ─────────────────────────────────────────────────────────────

  const handleEditMessage = useCallback(async (updatedMsg: ChatMessage) => {
    const res = await request.request<ChatMessage>(`/api/chat/messages/${updatedMsg.id}/edit`, {
      method: 'PATCH',
      body: JSON.stringify({ content: updatedMsg.content }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.code === 0 && res.data) {
      applyMessageUpdate(res.data);
      Toast.success('已修改');
    } else {
      Toast.error(res.message ?? '编辑失败');
    }
  }, [applyMessageUpdate]);

  const handleRecall = useCallback(async (msg: ChatMessage) => {
    if (msg.type === 'text') {
      setRecalledDrafts((prev) => ({
        ...prev,
        [msg.id]: { content: msg.content, mentions: msg.extra?.mentions ?? undefined },
      }));
      setInput(msg.content);
      setSelectedMentions(msg.extra?.mentions ?? []);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    const res = await request.request<null>(`/api/chat/messages/${msg.id}/recall`, { method: 'PATCH' });
    if (res.code !== 0) Toast.error(res.message ?? '撤回失败');
  }, []);

  const resetSearchFilters = useCallback(() => {
    setMsgSearch('');
    setSearchTypeFilters([]);
    setSearchSenderId(undefined);
    setSearchTimeRange(null);
    setSearchDatePreset('');
    setSearchResults([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchHasSearched(false);
    setShowSearchPanel(false);
  }, []);

  const applyDatePreset = useCallback((preset: SearchDatePreset) => {
    if (!preset) {
      setSearchDatePreset('');
      setSearchTimeRange(null);
      return;
    }
    const now = new Date();
    const start = new Date(now);
    if (preset === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (preset === '7d') {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else if (preset === '30d') {
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
    }
    setSearchDatePreset(preset);
    setSearchTimeRange([start, now]);
  }, []);

  const senderOptions = useMemo(() => {
    const optionMap = new Map<number, { value: number; label: string }>();
    if (currentUserId) {
      optionMap.set(currentUserId, { value: currentUserId, label: currentUserNickname || '我' });
    }
    if (activeConv?.type === 'direct' && activeConv.targetUser) {
      optionMap.set(activeConv.targetUser.id, { value: activeConv.targetUser.id, label: activeConv.targetUser.nickname });
    }
    searchMembers.forEach((member) => {
      optionMap.set(member.id, { value: member.id, label: member.nickname });
    });
    messages.forEach((message) => {
      if (message.senderId && message.senderName) {
        optionMap.set(message.senderId, { value: message.senderId, label: message.senderName });
      }
    });
    return Array.from(optionMap.values());
  }, [activeConv, currentUserId, currentUserNickname, messages, searchMembers]);

  useEffect(() => {
    if (!showSearchPanel || !activeConvId || activeConv?.type !== 'group') {
      if (!showSearchPanel) setSearchMembers([]);
      return;
    }
    void (async () => {
      const res = await request.get<ChatGroupMember[]>(`/api/chat/conversations/${activeConvId}/members`, { silent: true });
      if (res.code === 0 && res.data) setSearchMembers(res.data);
    })();
  }, [activeConv?.type, activeConvId, showSearchPanel]);

  const executeSearch = useCallback(async (targetPage = 1) => {
    if (!activeConvId) return;

    const hasCondition = Boolean(
      msgSearch.trim()
      || searchTypeFilters.length > 0
      || searchSenderId
      || searchTimeRange,
    );
    if (!hasCondition) {
      Toast.info('请先输入关键词或设置筛选条件');
      return;
    }

    const qs = new URLSearchParams();
    if (msgSearch.trim()) qs.set('keyword', msgSearch.trim());
    if (searchTypeFilters.length > 0) qs.set('types', searchTypeFilters.join(','));
    if (searchSenderId) qs.set('senderId', String(searchSenderId));
    if (searchTimeRange) {
      qs.set('startAt', formatDateTimeForApi(searchTimeRange[0]));
      qs.set('endAt', formatDateTimeForApi(searchTimeRange[1]));
    }
    qs.set('page', String(targetPage));
    qs.set('pageSize', '20');

    setSearchLoading(true);
    const res = await request.get<ChatMessageSearchResult>(
      `/api/chat/conversations/${activeConvId}/messages/search?${qs.toString()}`,
      { silent: true },
    );
    setSearchLoading(false);

    if (res.code === 0 && res.data) {
      setShowSearchPanel(true);
      setShowMembers(false);
      setSearchHasSearched(true);
      setSearchPage(targetPage);
      setSearchResults(targetPage === 1 ? res.data.list : [...searchResults, ...res.data.list]);
      setSearchTotal(res.data.total);
      return;
    }

    setSearchHasSearched(false);
    setShowSearchPanel(false);
    Toast.info('服务端搜索暂不可用，已保留本地模糊过滤');
  }, [activeConvId, msgSearch, searchResults, searchSenderId, searchTimeRange, searchTypeFilters]);

  const jumpToSearchResult = useCallback(async (item: ChatMessageSearchItem) => {
    if (!activeConvId) return;
    const res = await request.get<ChatMessageContext>(
      `/api/chat/conversations/${activeConvId}/messages/${item.message.id}/context?before=15&after=15`,
      { silent: true },
    );
    if (res.code !== 0 || !res.data) {
      Toast.error(res.message ?? '定位消息失败');
      return;
    }
    setMessages(res.data.list);
    setHasMore(res.data.hasBefore);
    setOldestMsgId(res.data.list[0]?.id ?? null);
    setContextMode({ anchorMessageId: res.data.anchorMessageId, keyword: msgSearch.trim() || item.snippet });
    setTimeout(() => scrollToMessage(res.data.anchorMessageId), 80);
  }, [activeConvId, msgSearch, scrollToMessage]);

  const restoreLatestMessages = useCallback(async () => {
    if (!activeConvId) return;
    await fetchMessages(activeConvId);
  }, [activeConvId, fetchMessages]);

  const fetchMediaItems = useCallback(async (convId: number, type: 'image' | 'file' | 'link', p = 1) => {
    setMediaLoading(true);
    if (p === 1) setMediaItems([]);  // 切换 tab 时立即清空，避免旧数据短暂闪烁
    const qs = type === 'link'
      ? new URLSearchParams({ types: 'text', keyword: 'http', page: String(p), pageSize: '30' })
      : new URLSearchParams({ types: type, page: String(p), pageSize: '30' });
    const res = await request.get<{ list: Array<{ message: ChatMessage }> }>(
      `/api/chat/conversations/${convId}/messages/search?${qs.toString()}`,
      { silent: true },
    );
    setMediaLoading(false);
    if (res.code === 0 && res.data) {
      const rawCount = res.data.list.length;
      let items = res.data.list.map((item) => item.message);
      if (type === 'link') {
        items = items.filter((m) => m.extra?.linkPreview || /https?:\/\//i.test(m.content));
      }
      if (p === 1) {
        setMediaItems(items);
      } else {
        setMediaItems((prev) => [...prev, ...items]);
      }
      setMediaPage(p);
      setMediaHasMore(rawCount >= 30);
    }
  }, []);

  useEffect(() => {
    if (!showMediaPanel || !activeConvId) return;
    void fetchMediaItems(activeConvId, mediaType, 1);
  }, [showMediaPanel, activeConvId, mediaType, fetchMediaItems]);

  const refreshGroupAvatarMembers = useCallback(async (conversationId: number) => {
    const res = await request.get<ChatGroupMember[]>(`/api/chat/conversations/${conversationId}/members`, { silent: true });
    if (res.code !== 0 || !res.data) return;
    setGroupAvatarMap((prev) => ({
      ...prev,
      [conversationId]: res.data.slice(0, 9).map((m) => ({ id: m.id, nickname: m.nickname, avatar: m.avatar })),
    }));
  }, []);

  const handleWsMessage = useCallback((wsMsg: WsMessage) => {
    if (wsMsg.type === 'chat:message') {
      const msg = wsMsg.payload;
      const isOwnMsg = msg.senderId === currentUserId;
      const mentionedMe = !isOwnMsg && (msg.extra?.mentions ?? []).some((item) => item.userId === currentUserId);
      const shouldAutoRead = msg.conversationId === activeConvId && (isOwnMsg || isAtBottomRef.current);
      if (msg.conversationId === activeConvId) {
        appendMessageOnce(msg);
        if (shouldAutoRead) {
          setTimeout(() => virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' }), 80);
          request.post(`/api/chat/conversations/${msg.conversationId}/read`, {}, { silent: true }).catch(() => {});
          setPendingNewMsgCount(0);
        } else if (!isOwnMsg) {
          setPendingNewMsgCount((v) => v + 1);
        }
      }
      setConversations((prev) => {
        const isActive = msg.conversationId === activeConvId;
        const updated = prev.map((c) =>
          c.id === msg.conversationId
            ? {
              ...c,
              lastMessage: msg,
              unreadCount: isOwnMsg ? c.unreadCount : (isActive && shouldAutoRead ? 0 : c.unreadCount + 1),
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
        if (!isConvMuted) Toast.info(`${msg.senderName ?? '有人'} @了你`);
      }
    } else if (wsMsg.type === 'chat:recall') {
      const { messageId } = wsMsg.payload;
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, isRecalled: true, content: '消息已撤回' } : m),
      );
    } else if (wsMsg.type === 'chat:edit') {
      applyMessageUpdate(wsMsg.payload);
    } else if (wsMsg.type === 'chat:reaction') {
      const { messageId, reactions } = wsMsg.payload;
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions } : m));
    } else if (wsMsg.type === 'chat:vote-update') {
      const { messageId, voteData } = wsMsg.payload;
      setMessages((prev) => prev.map((m) =>
        m.id === messageId ? { ...m, extra: { ...(m.extra ?? {}), voteData } } : m,
      ));
    } else if (wsMsg.type === 'chat:typing') {
      const { conversationId, userId, nickname } = wsMsg.payload;
      if (conversationId !== activeConvId || userId === currentUserId) return;
      setTypingUsers((prev) => {
        const existing = prev[userId];
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
          setTypingUsers((p) => {
            const next = { ...p };
            delete next[userId];
            return next;
          });
        }, 4000);
        return { ...prev, [userId]: { nickname, timer } };
      });
    } else if (wsMsg.type === 'chat:member-join') {
      void refreshGroupAvatarMembers(wsMsg.payload.conversationId);
      if (wsMsg.payload.conversationId === activeConvId) {
        void fetchConversations();
      }
    } else if (wsMsg.type === 'chat:member-leave') {
      const { conversationId, userId } = wsMsg.payload;
      if (userId === currentUserId) {
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        if (activeConvId === conversationId) {
          setActiveConvId(null);
          setMessages([]);
        }
        Toast.warning('你已被移出该群聊');
      } else {
        void refreshGroupAvatarMembers(conversationId);
      }
    } else if (wsMsg.type === 'chat:group-update') {
      const { conversationId, name, announcement } = wsMsg.payload;
      setConversations((prev) =>
        prev.map((c) => c.id === conversationId
          ? {
            ...c,
            ...(name !== undefined ? { name } : {}),
            ...(announcement !== undefined ? { announcement } : {}),
          }
          : c),
      );
    }
  }, [activeConvId, appendMessageOnce, applyMessageUpdate, conversations, currentUserId, fetchConversations, refreshGroupAvatarMembers]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    if (!atBottom || !activeConvId) return;
    // 在上下文定位模式下滚动到底部时，自动恢复最新消息
    if (contextMode) {
      void restoreLatestMessages();
      return;
    }
    if (pendingNewMsgCount > 0) setPendingNewMsgCount(0);
    request.post(`/api/chat/conversations/${activeConvId}/read`, {}, { silent: true }).catch(() => {});
    setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0, hasMentionUnread: false } : c)));
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
          request.post(`/api/chat/conversations/${activeConvId}/read`, {}, { silent: true }).catch(() => {});
          setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0, hasMentionUnread: false } : c)));
        }
      }

      Toast.success('实时连接已恢复，已同步最新消息');
    })();
  }, [activeConvId, contextMode, fetchConversations, fetchMessages, wsConnected]);

  // 草稿自动保存（input 变化时持久化）
  useEffect(() => {
    if (activeConvId) saveDraft(activeConvId, input);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // mentionCandidates 变化时重置高亮到第一项
  useEffect(() => {
    setMentionActiveIndex(0);
  }, [mentionCandidates]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const handleEmojiSelect = useCallback((emoji: { native: string }) => {
    const ta = inputRef.current;
    if (!ta) {
      setInput((prev) => prev + emoji.native);
      return;
    }
    const start = ta.selectionStart ?? input.length;
    const end = ta.selectionEnd ?? input.length;
    setInput((prev) => prev.slice(0, start) + emoji.native + prev.slice(end));
    setEmojiVisible(false);
    requestAnimationFrame(() => {
      const pos = start + emoji.native.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
  }, [input]);

  const filteredConvs = conversations.filter((c) => {
    if (!convSearch) return true;
    const name = c.type === 'direct' ? (c.targetUser?.nickname ?? '') : (c.name ?? '');
    return name.toLowerCase().includes(convSearch.toLowerCase());
  });

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [onUnreadChange, totalUnread]);

  const galleryImages = messages.filter((m) => m.type === 'image' && !m.isRecalled);
  const visibleMessages = messages.filter((m) => !currentUserId || !(m.extra?.hiddenFor ?? []).includes(currentUserId));
  const displayMessages = visibleMessages;

  useEffect(() => {
    const groupIds = conversations.filter((c) => c.type === 'group').map((c) => c.id);
    const missingIds = groupIds.filter((id) => !groupAvatarMap[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missingIds.map(async (id) => {
        const res = await request.get<ChatGroupMember[]>(`/api/chat/conversations/${id}/members`, { silent: true });
        return [id, (res.code === 0 && res.data ? res.data : []).slice(0, 9)] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setGroupAvatarMap((prev) => {
        const next = { ...prev };
        for (const [id, members] of entries) {
          next[id] = members.map((m) => ({ id: m.id, nickname: m.nickname, avatar: m.avatar }));
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [conversations, groupAvatarMap, refreshGroupAvatarMembers]);

  const rootStyle: React.CSSProperties = isQuick
    ? {
      display: 'flex',
      height: '100%',
      minHeight: 0,
      border: 'none',
      borderRadius: 0,
      overflow: 'hidden',
      background: 'var(--semi-color-bg-1)',
    }
    : {
      display: 'flex',
      height: '100%',
      minHeight: 500,
      border: '1px solid var(--semi-color-border)',
      borderRadius: 8,
      overflow: 'hidden',
      background: 'var(--semi-color-bg-1)',
    };

  return (
    <div style={rootStyle}>

      {/* Left: conversation list */}
      <div
        style={{
          width: isQuick ? '100%' : 280,
          borderRight: isQuick ? 'none' : '1px solid var(--semi-color-border)',
          display: isQuick && activeConv ? 'none' : 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalUnread > 0 ? (
            <Badge count={totalUnread} overflowCount={99} style={{ flex: 1 }}>
              <Title heading={6} style={{ margin: 0 }}>消息</Title>
            </Badge>
          ) : (
            <Title heading={6} style={{ margin: 0, flex: 1 }}>消息</Title>
          )}
          <Tooltip content="新建对话">
            <Button
              size="small" theme="borderless" type="primary"
              icon={<MessageSquarePlus size={16} />}
              onClick={() => setShowNewChat((v) => !v)}
            />
          </Tooltip>
          {isQuick && onOpenFullPage && (
            <Tooltip content="前往聊天页">
              <Button
                size="small"
                theme="borderless"
                type="tertiary"
                icon={<ExternalLink size={15} />}
                onClick={() => onOpenFullPage(activeConvId)}
              />
            </Tooltip>
          )}
          {isQuick && onClose && (
            <Tooltip content="关闭">
              <Button
                size="small"
                theme="borderless"
                type="tertiary"
                icon={<X size={15} />}
                onClick={onClose}
              />
            </Tooltip>
          )}
        </div>

        {showNewChat && (
          <Modal
            title="新建对话"
            visible={showNewChat}
            onCancel={() => setShowNewChat(false)}
            footer={null}
            width={480}
            centered
          >
            <NewChatPanel
              onSelectUser={(u) => { handleNewDirectChat(u); setShowNewChat(false); }}
              onGroupCreated={(c) => { handleGroupCreated(c); setShowNewChat(false); }}
            />
          </Modal>
        )}

        <div style={{ padding: '8px 12px' }}>
          <Input prefix={<Search size={13} />} placeholder="搜索会话" size="small" value={convSearch} onChange={setConvSearch} />
        </div>

        <div style={{ padding: '0 12px 8px', display: 'flex', gap: 8 }}>
          <Button
            size="small"
            theme={leftPaneMode === 'conversations' ? 'solid' : 'borderless'}
            type={leftPaneMode === 'conversations' ? 'primary' : 'tertiary'}
            onClick={() => setLeftPaneMode('conversations')}
          >
            消息
          </Button>
          <Button
            size="small"
            theme={leftPaneMode === 'favorites' ? 'solid' : 'borderless'}
            type={leftPaneMode === 'favorites' ? 'primary' : 'tertiary'}
            icon={<Bookmark size={13} />}
            onClick={() => setLeftPaneMode('favorites')}
          >
            收藏
          </Button>
          <Button
            size="small"
            theme={leftPaneMode === 'globalSearch' ? 'solid' : 'borderless'}
            type={leftPaneMode === 'globalSearch' ? 'primary' : 'tertiary'}
            icon={<Search size={13} />}
            onClick={() => setLeftPaneMode('globalSearch')}
          >
            搜索
          </Button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Spin spinning={loadingConvs}>
            {leftPaneMode === 'conversations' && (
              <SemiList
                dataSource={filteredConvs}
                emptyContent={loadingConvs ? null : <Empty description="暂无会话" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />}
                split={false}
                renderItem={(conv: ChatConversation) => {
                  const name = conv.type === 'direct' ? (conv.targetUser?.nickname ?? '未知用户') : (conv.name ?? '群聊');
                  const avatarName = conv.type === 'direct' ? (conv.targetUser?.nickname ?? '?') : (conv.name ?? '?');
                  const avatar = conv.type === 'direct' ? conv.targetUser?.avatar : null;
                  const groupMembers = conv.type === 'group' ? groupAvatarMap[conv.id] : undefined;
                  const avatarNode = conv.type === 'group'
                    ? <GroupGridAvatar name={avatarName} size={38} members={groupMembers} />
                    : <UserAvatar name={avatarName} avatar={avatar} size={38} />;
                  const lastMsg = conv.lastMessage;
                  const isActive = conv.id === activeConvId;
                  const isPinned = conv.isPinned ?? false;
                  const isStarred = conv.isStarred ?? false;
                  const isMuted = conv.isMuted ?? false;
                  const hasMentionUnread = conv.hasMentionUnread ?? false;
                  const hasFailedMsg = failedMessages.some((m) => m.convId === conv.id);
                  const draftText = isActive ? '' : (draftsMap[conv.id] ?? '');
                  const hasDraft = draftText.trim().length > 0;
                  let lastMsgText = '暂无消息';
                  if (lastMsg) {
                    const summary = getMessageSummary(lastMsg);
                    if (conv.type === 'group' && lastMsg.senderName && lastMsg.type !== 'system' && !lastMsg.isRecalled) {
                      lastMsgText = `${lastMsg.senderName}：${summary}`;
                    } else {
                      lastMsgText = summary;
                    }
                  }

                  return (
                    <SemiList.Item
                      key={conv.id}
                      align="center"
                      onClick={() => { void handleSelectConv(conv); }}
                      onRightClick={(e) => {
                        e.preventDefault();
                        setLeftPaneContextMenu({ x: e.clientX, y: e.clientY, type: 'conversation', conv });
                      }}
                      style={{
                        padding: '10px 12px',
                        cursor: 'pointer',
                        background: isActive ? 'var(--semi-color-primary-light-default)' : 'transparent',
                      }}
                      onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--semi-color-fill-0)'; }}
                      onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      header={conv.unreadCount > 0 ? (
                        <Badge count={conv.unreadCount} overflowCount={99} dot={false}>
                          {avatarNode}
                        </Badge>
                      ) : avatarNode}
                      main={(
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* 第一行：图标 + 名称 + 免打扰 */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
                              {isPinned && <Pin size={10} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />}
                              {isStarred && <Star size={10} style={{ color: '#facc15', flexShrink: 0 }} />}
                              <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {name}
                              </Text>
                            </div>
                            {isMuted && <BellOff size={11} style={{ color: 'var(--semi-color-text-3)', flexShrink: 0 }} />}
                          </div>
                          {/* 第二行：消息预览 + 时间 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, marginTop: 2 }}>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                              {hasFailedMsg && (
                                <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--semi-color-danger)', fontWeight: 500 }}>[发送失败]</span>
                              )}
                              {!hasFailedMsg && hasDraft && (
                                <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--semi-color-danger)', fontWeight: 500 }}>[草稿]</span>
                              )}
                              {!hasFailedMsg && !hasDraft && hasMentionUnread && (
                                <span
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 11,
                                    lineHeight: '16px',
                                    padding: '0 4px',
                                    borderRadius: 4,
                                    color: 'var(--semi-color-danger)',
                                    background: 'var(--semi-color-danger-light-default)',
                                  }}
                                >
                                  @我
                                </span>
                              )}
                              <Text
                                type={(hasFailedMsg || hasDraft) ? 'danger' : 'tertiary'}
                                style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
                              >
                                {hasDraft ? draftText.trim() : lastMsgText}
                              </Text>
                            </div>
                            {lastMsg && (
                              <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>
                                {formatConvTime(lastMsg.createdAt)}
                              </Text>
                            )}
                          </div>
                        </div>
                      )}
                    />
                  );
                }}
              />
            )}
            {leftPaneMode === 'favorites' && (
              <SemiList
                dataSource={favoriteMessages}
                emptyContent={loadingConvs ? null : <Empty description="暂无收藏消息" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />}
                split={false}
                renderItem={(msg: ChatMessage) => {
                  const conv = conversations.find((item) => item.id === msg.conversationId);
                  const convName = conv?.type === 'direct' ? (conv.targetUser?.nickname ?? '私聊') : (conv?.name ?? '群聊');
                  return (
                    <SemiList.Item
                      key={msg.id}
                      onClick={() => {
                        setFavPreviewMsg(msg);
                        setFavPreviewVisible(true);
                      }}
                      onRightClick={(e) => {
                        e.preventDefault();
                        setLeftPaneContextMenu({ x: e.clientX, y: e.clientY, type: 'favorite', msg });
                      }}
                      style={{ padding: '10px 12px', cursor: 'pointer' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--semi-color-fill-0)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      main={(
                        <div style={{ minWidth: 0, width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                            <Text strong style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{convName}</Text>
                            <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(msg.createdAt)}</Text>
                          </div>
                          <Text type="tertiary" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getMessageSummary(msg)}
                          </Text>
                        </div>
                      )}
                    />
                  );
                }}
              />
            )}
            {leftPaneMode === 'globalSearch' && (
              <div style={{ padding: '8px 12px 0' }}>
                <Input
                  prefix={<Search size={13} />}
                  placeholder="搜索全部消息内容"
                  size="small"
                  value={globalSearchKeyword}
                  onChange={(v) => {
                    setGlobalSearchKeyword(v);
                    if (!v.trim()) {
                      setGlobalSearchResults([]);
                      setGlobalSearchTotal(0);
                      setGlobalSearchHasSearched(false);
                    }
                  }}
                  onEnterPress={async () => {
                    const kw = globalSearchKeyword.trim();
                    if (!kw) return;
                    setGlobalSearchLoading(true);
                    const res = await request.get<{
                      list: import('@zenith/shared').ChatMessageSearchItem[];
                      total: number;
                      page: number;
                      pageSize: number;
                      conversationNames: Record<string, string>;
                    }>(`/api/chat/messages/global-search?keyword=${encodeURIComponent(kw)}&page=1&pageSize=20`, { silent: true });
                    setGlobalSearchLoading(false);
                    if (res.code === 0 && res.data) {
                      setGlobalSearchResults(res.data.list);
                      setGlobalSearchTotal(res.data.total);
                      setGlobalSearchPage(1);
                      setGlobalSearchConvNames(res.data.conversationNames);
                      setGlobalSearchHasSearched(true);
                    }
                  }}
                  showClear
                />
                {globalSearchHasSearched && (
                  <Text type="tertiary" style={{ display: 'block', fontSize: 11, padding: '6px 0 2px' }}>
                    共 {globalSearchTotal} 条结果
                  </Text>
                )}
              </div>
            )}
            {leftPaneMode === 'globalSearch' && globalSearchLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                <Spin />
              </div>
            )}
              {leftPaneMode === 'globalSearch' && globalSearchHasSearched && !globalSearchLoading && (
                <SemiList
                  dataSource={globalSearchResults}
                  emptyContent={<Empty description="未找到相关消息" style={{ padding: '30px 0' }} imageStyle={{ width: 60 }} />}
                  split={false}
                  renderItem={(item: ChatMessageSearchItem) => {
                    const convName = globalSearchConvNames[String(item.message.conversationId)] ?? '会话';
                    return (
                      <SemiList.Item
                        key={item.message.id}
                        onClick={async () => {
                          const res = await request.get<ChatMessageContext>(
                            `/api/chat/conversations/${item.message.conversationId}/messages/${item.message.id}/context?before=15&after=15`,
                            { silent: true },
                          );
                          if (res.code !== 0 || !res.data) {
                            import('@douyinfe/semi-ui').then(({ Toast }) => Toast.error('定位消息失败'));
                            return;
                          }
                          const targetConv = conversations.find((c) => c.id === item.message.conversationId);
                          if (!targetConv) {
                            // 会话不在列表中，刷新列表再定位
                            await fetchConversations();
                          }
                          setActiveConvId(item.message.conversationId);
                          onConvChange?.(item.message.conversationId);
                          setLeftPaneMode('conversations');
                          setMessages(res.data.list);
                          setHasMore(res.data.hasBefore);
                          setOldestMsgId(res.data.list[0]?.id ?? null);
                          setContextMode({ anchorMessageId: res.data.anchorMessageId, keyword: globalSearchKeyword.trim() });
                          setTimeout(() => scrollToMessage(res.data.anchorMessageId), 80);
                        }}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--semi-color-fill-0)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        main={(
                          <div style={{ minWidth: 0, width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                              <Text strong style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{convName}</Text>
                              <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(item.message.createdAt)}</Text>
                            </div>
                            {item.message.senderName && (
                              <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>{item.message.senderName}</Text>
                            )}
                            <Text type="tertiary" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.snippet}
                            </Text>
                          </div>
                        )}
                      />
                    );
                  }}
                />
              )}
            {leftPaneMode === 'globalSearch' && globalSearchHasSearched && !globalSearchLoading
              && globalSearchResults.length < globalSearchTotal && (
              <div style={{ padding: '8px 12px', textAlign: 'center' }}>
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  loading={globalSearchLoading}
                  onClick={async () => {
                    const kw = globalSearchKeyword.trim();
                    if (!kw) return;
                    const nextPage = globalSearchPage + 1;
                    setGlobalSearchLoading(true);
                    const res = await request.get<{
                      list: import('@zenith/shared').ChatMessageSearchItem[];
                      total: number;
                      page: number;
                      pageSize: number;
                      conversationNames: Record<string, string>;
                    }>(`/api/chat/messages/global-search?keyword=${encodeURIComponent(kw)}&page=${nextPage}&pageSize=20`, { silent: true });
                    setGlobalSearchLoading(false);
                    if (res.code === 0 && res.data) {
                      setGlobalSearchResults((prev) => [...prev, ...res.data.list]);
                      setGlobalSearchPage(nextPage);
                      setGlobalSearchConvNames((prev) => ({ ...prev, ...res.data.conversationNames }));
                    }
                  }}
                >
                  加载更多
                </Button>
              </div>
            )}
            {leftPaneContextMenu && (
              <Dropdown
                trigger="click"
                visible
                clickToHide
                position="bottomLeft"
                getPopupContainer={() => document.body}
                onVisibleChange={(visible) => {
                  if (!visible) setLeftPaneContextMenu(null);
                }}
                render={leftPaneContextMenu.type === 'conversation' ? (
                  <Dropdown.Menu>
                    <Dropdown.Item
                      icon={<Pin size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isPinned = conv.isPinned ?? false;
                        void request.patch(`/api/chat/conversations/${conv.id}/pin`, { pin: !isPinned }).then((r) => {
                          if ((r as { code: number }).code === 0) {
                            setConversations((prev) => {
                              const updated = prev.map((c) => c.id === conv.id ? { ...c, isPinned: !isPinned } : c);
                              updated.sort((a, b) => {
                                if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                                const ta = a.lastMessage?.createdAt ?? a.createdAt;
                                const tb = b.lastMessage?.createdAt ?? b.createdAt;
                                return tb.localeCompare(ta);
                              });
                              return updated;
                            });
                            Toast.success(isPinned ? '已取消置顶' : '已置顶');
                          }
                        });
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isPinned ?? false) ? '取消置顶' : '置顶'}
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<Star size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isStarred = conv.isStarred ?? false;
                        void request.patch(`/api/chat/conversations/${conv.id}/star`, { star: !isStarred }).then((r) => {
                          if ((r as { code: number }).code === 0) {
                            setConversations((prev) =>
                              prev.map((c) => c.id === conv.id ? { ...c, isStarred: !isStarred } : c),
                            );
                            Toast.success(isStarred ? '已取消星标' : '已标记星标');
                          }
                        });
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isStarred ?? false) ? '取消星标' : '标记星标'}
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<BellOff size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isMuted = conv.isMuted ?? false;
                        void request.patch(`/api/chat/conversations/${conv.id}/mute`, { mute: !isMuted }).then((r) => {
                          if ((r as { code: number }).code === 0) {
                            setConversations((prev) =>
                              prev.map((c) => c.id === conv.id ? { ...c, isMuted: !isMuted } : c),
                            );
                            Toast.success(isMuted ? '已取消免打扰' : '已开启免打扰');
                          }
                        });
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isMuted ?? false) ? '取消免打扰' : '免打扰'}
                    </Dropdown.Item>
                    <Dropdown.Divider />
                    <Dropdown.Item
                      type="danger"
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        Modal.confirm({
                          title: '确定要删除该会话吗？',
                          content: '删除后仅移除你当前账号下的会话记录，无法恢复。',
                          okButtonProps: { type: 'danger', theme: 'solid' },
                          onOk: () => {
                            void request.delete(`/api/chat/conversations/${conv.id}`).then((r) => {
                              if ((r as { code: number; message?: string }).code === 0) {
                                Toast.success('会话已删除');
                                setConversations((prev) => prev.filter((c) => c.id !== conv.id));
                                if (activeConvId === conv.id) {
                                  setActiveConvId(null);
                                  setMessages([]);
                                  setPendingNewMsgCount(0);
                                }
                              } else {
                                Toast.error((r as { message?: string }).message ?? '删除失败');
                              }
                            });
                          },
                        });
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      删除会话
                    </Dropdown.Item>
                  </Dropdown.Menu>
                ) : (
                  <Dropdown.Menu>
                    <Dropdown.Item
                      icon={<Search size={12} />}
                      onClick={() => {
                        void openFavoriteMessage(leftPaneContextMenu.msg);
                        setFavPreviewVisible(false);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      定位到原消息
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<Bookmark size={12} />}
                      onClick={() => {
                        void handleToggleFavorite(leftPaneContextMenu.msg);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      取消收藏
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<Pin size={12} />}
                      onClick={() => {
                        void handleTogglePinMessage(leftPaneContextMenu.msg);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {leftPaneContextMenu.msg.extra?.isPinned ? '取消置顶消息' : '置顶消息'}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                )}
              >
                <span
                  style={{
                    position: 'fixed',
                    left: leftPaneContextMenu.x,
                    top: leftPaneContextMenu.y,
                    width: 1,
                    height: 1,
                  }}
                />
              </Dropdown>
            )}
          </Spin>
        </div>
      </div>

      {/* Right: chat area */}
      {activeConv ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header */}
          <div style={{ padding: isQuick ? '10px 12px' : '10px 20px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: isQuick ? 6 : 10 }}>
            {isQuick && (
              <Tooltip content="返回会话列表">
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  icon={<ArrowLeft size={16} />}
                  onClick={() => setActiveConvId(null)}
                />
              </Tooltip>
            )}
            {activeConv.type === 'direct' && activeConv.targetUser && (
              <>
                <Popover
                  trigger="click"
                  position="bottomLeft"
                  showArrow
                  content={(
                    <div style={{ padding: '8px 4px', minWidth: 220 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <UserAvatar name={activeConv.targetUser.nickname} avatar={activeConv.targetUser.avatar} size={44} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{activeConv.targetUser.nickname}</div>
                          {activeConv.targetUser.departmentName && (
                            <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 2 }}>{activeConv.targetUser.departmentName}</div>
                          )}
                        </div>
                      </div>
                      {(activeConv.targetUser.positionNames ?? []).length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                          <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13, minWidth: 52 }}>岗位</span>
                          <span style={{ fontSize: 13 }}>{(activeConv.targetUser.positionNames ?? []).join('、')}</span>
                        </div>
                      )}
                      {activeConv.targetUser.phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13, minWidth: 52 }}>手机</span>
                          <span style={{ fontSize: 13 }}>{activeConv.targetUser.phone}</span>
                        </div>
                      )}
                      {activeConv.targetUser.email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13, minWidth: 52 }}>邮箱</span>
                          <span style={{ fontSize: 13 }}>{activeConv.targetUser.email}</span>
                        </div>
                      )}
                    </div>
                  )}
                >
                  <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: isQuick ? 6 : 8, maxWidth: '40%', minWidth: 0 }}>
                    <UserAvatar name={activeConv.targetUser.nickname} avatar={activeConv.targetUser.avatar} size={isQuick ? 28 : 32} />
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                      <Title
                        heading={6}
                        style={{
                          margin: 0,
                          lineHeight: '1.2',
                          fontSize: isQuick ? 15 : undefined,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          flexShrink: 0,
                        }}
                      >
                        {activeConv.targetUser.nickname}
                      </Title>
                      {activeConv.targetUser.departmentName && (
                        <Text size="small" type="tertiary" style={{ whiteSpace: 'nowrap', flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {activeConv.targetUser.departmentName}
                        </Text>
                      )}
                    </span>
                  </span>
                </Popover>
                <span style={{ flex: 1 }} />
              </>
            )}
            {activeConv.type === 'group' && (
              <>
                <GroupGridAvatar name={activeConv.name ?? '群聊'} size={isQuick ? 28 : 32} members={groupAvatarMap[activeConv.id]} />
                <Title
                  heading={6}
                  style={{
                    margin: 0,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: isQuick ? 15 : undefined,
                  }}
                >
                  {activeConv.name ?? '群聊'}
                </Title>
              </>
            )}
            {!isQuick && (
              <>
                {activeConv.type === 'group' && (
                  <Tooltip content="群公告历史">
                    <Button
                      size="small"
                      theme="borderless"
                      type={announcementHistoryVisible ? 'primary' : 'tertiary'}
                      icon={<History size={15} />}
                      onClick={() => {
                        if (!activeConvId) return;
                        void fetchAnnouncementHistory(activeConvId);
                        setAnnouncementHistoryVisible(true);
                      }}
                    />
                  </Tooltip>
                )}
                <Tooltip content={showSearchPanel ? '关闭聊天记录' : '聊天记录'}>
                  <Button
                    size="small"
                    theme="borderless"
                    type={showSearchPanel ? 'primary' : 'tertiary'}
                    icon={<Search size={15} />}
                    onClick={() => {
                      setShowSearchPanel((v) => {
                        const next = !v;
                        if (next) { setShowMembers(false); setShowMediaPanel(false); }
                        return next;
                      });
                    }}
                  />
                </Tooltip>
                <Tooltip content={showMediaPanel ? '关闭媒体库' : '图片与文件'}>
                  <Button
                    size="small"
                    theme="borderless"
                    type={showMediaPanel ? 'primary' : 'tertiary'}
                    icon={<Images size={15} />}
                    onClick={() => {
                      setShowMediaPanel((v) => {
                        const next = !v;
                        if (next) { setShowMembers(false); setShowSearchPanel(false); }
                        return next;
                      });
                    }}
                  />
                </Tooltip>
                {activeConv.type === 'group' && (
                  <Tooltip content={showMembers ? '关闭群信息' : '群信息'}>
                    <Button
                      size="small" theme="borderless" type={showMembers ? 'primary' : 'tertiary'}
                      icon={<MoreHorizontal size={15} />}
                      onClick={() => {
                        setShowMembers((v) => {
                          const next = !v;
                          if (next) { setShowSearchPanel(false); setShowMediaPanel(false); }
                          return next;
                        });
                      }}
                    />
                  </Tooltip>
                )}
              </>
            )}
            {isQuick && onOpenFullPage && (
              <Tooltip content="前往聊天页">
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  icon={<ExternalLink size={15} />}
                  onClick={() => onOpenFullPage(activeConvId)}
                />
              </Tooltip>
            )}
            {isQuick && onClose && (
              <Tooltip content="关闭">
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  icon={<X size={15} />}
                  onClick={onClose}
                />
              </Tooltip>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Messages */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', overflow: 'hidden' }}>
              {loadingMsgs && messages.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Spin size="middle" />
                </div>
              ) : displayMessages.length === 0 && failedMessages.filter((m) => m.convId === activeConvId).length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                  {!wsConnected && (
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px', borderRadius: 8,
                        background: 'var(--semi-color-warning-light-default)',
                        border: '1px solid var(--semi-color-warning-light-active)',
                        color: 'var(--semi-color-warning)',
                      }}
                    >
                      <AlertCircle size={14} style={{ flexShrink: 0 }} />
                      <Text style={{ flex: 1, fontSize: 12, color: 'inherit' }}>
                        实时连接已断开，正在自动重连。重连期间仍可发送消息，但新消息可能会延迟同步。
                      </Text>
                    </div>
                  )}
                  <Empty description="发送第一条消息吧" imageStyle={{ width: 80 }} />
                </div>
              ) : (
                <Virtuoso
                  ref={virtuosoRef}
                  style={{ flex: 1 }}
                  data={displayMessages}
                  firstItemIndex={firstItemIndex}
                  initialTopMostItemIndex={Math.max(displayMessages.length - 1, 0)}
                  followOutput={false}
                  startReached={handleStartReached}
                  atBottomStateChange={handleAtBottomStateChange}
                  atBottomThreshold={120}
                  increaseViewportBy={{ top: 600, bottom: 200 }}
                  computeItemKey={(_idx, msg) => msg.id}
                  components={{
                    Header: () => (
                      <div style={{ padding: isQuick ? '8px 12px 0' : '12px 20px 0' }}>
                        {!wsConnected && (
                          <div
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                              padding: '8px 10px', borderRadius: 8,
                              background: 'var(--semi-color-warning-light-default)',
                              border: '1px solid var(--semi-color-warning-light-active)',
                              color: 'var(--semi-color-warning)',
                            }}
                          >
                            <AlertCircle size={14} style={{ flexShrink: 0 }} />
                            <Text style={{ flex: 1, fontSize: 12, color: 'inherit' }}>
                              实时连接已断开，正在自动重连。重连期间仍可发送消息，但新消息可能会延迟同步。
                            </Text>
                          </div>
                        )}
                        {pinnedMessages.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)' }}>
                            <Text strong style={{ fontSize: 12 }}><Pin size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />置顶消息</Text>
                              <SemiList
                                dataSource={pinnedMessages}
                                split={false}
                                renderItem={(item: ChatMessage) => (
                                  <SemiList.Item
                                    key={item.id}
                                    align="center"
                                    onClick={() => scrollToMessage(item.id)}
                                    style={{ padding: 0, cursor: 'pointer' }}
                                    main={(
                                      <Text type="tertiary" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {getMessageSummary(item)}
                                      </Text>
                                    )}
                                    extra={(
                                      <button
                                        type="button"
                                        title="取消置顶"
                                        onClick={(event) => { event.stopPropagation(); void handleTogglePinMessage(item); }}
                                        style={{ flexShrink: 0, border: 'none', background: 'transparent', padding: 2, cursor: 'pointer', color: 'var(--semi-color-text-2)', display: 'flex', alignItems: 'center', borderRadius: 4 }}
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--semi-color-danger)'; }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--semi-color-text-2)'; }}
                                      >
                                        <PinOff size={12} />
                                      </button>
                                    )}
                                  />
                                )}
                              />
                          </div>
                        )}
                        {hasMore && loadingMsgs && (
                          <div style={{ textAlign: 'center', marginBottom: 8, minHeight: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Spin size="small" />
                          </div>
                        )}
                      </div>
                    ),
                  }}
                  itemContent={(virtualIndex, msg) => {
                    const realIndex = virtualIndex - firstItemIndex;
                    return (
                      <div style={{ padding: isQuick ? '0 12px' : '0 20px' }}>
                        <MessageBubble
                          msg={msg}
                          isSelf={msg.senderId === currentUserId}
                          onReply={setReplyTo}
                          onRecall={handleRecall}
                          onOpenImage={(imageMsg) => { void openImagePreview(imageMsg, galleryImages); }}
                          shouldShowTime={shouldDisplayMessageTime(msg, displayMessages[realIndex + 1])}
                          getReplyMessage={getReplyMessage}
                          onScrollToMessage={scrollToMessage}
                          onToggleFavorite={handleToggleFavorite}
                          onTogglePin={handleTogglePinMessage}
                          onEditRecalled={handleEditRecalled}
                          recalledDraft={recalledDrafts[msg.id]}
                          multiSelectMode={multiSelectMode}
                          isSelected={selectedMessageIds.includes(msg.id)}
                          onToggleSelect={handleToggleSelectMessage}
                          onForwardSingle={handleForwardSingle}
                          onOpenForwardView={handleOpenForwardView}
                          onDeleteMessage={handleDeleteSingle}
                          onReaction={handleReaction}
                          onPickReactionEmoji={handlePickReactionEmoji}
                          currentUserId={currentUserId}
                          onEdit={handleEditMessage}
                          onVote={handleVoteMessage}
                          isHighlighted={highlightedMessageId === msg.id}
                        />
                      </div>
                    );
                  }}
                />
              )}
              {/* ⑥ 发送失败重试 */}
              {failedMessages.filter((m) => m.convId === activeConvId).length > 0 && (
                <div style={{ padding: isQuick ? '0 12px 8px' : '0 20px 8px', flexShrink: 0 }}>
                  <SemiList
                    split={false}
                    dataSource={failedMessages.filter((m) => m.convId === activeConvId)}
                    renderItem={(failed) => (
                      <SemiList.Item
                        key={failed.id}
                        style={{
                          padding: '8px 12px', margin: '4px 0',
                          background: 'var(--semi-color-danger-light-default)',
                          border: '1px solid var(--semi-color-danger-light-active)',
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <AlertCircle size={14} style={{ color: 'var(--semi-color-danger)', marginTop: 2, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 13, wordBreak: 'break-word', color: 'var(--semi-color-text-0)' }}>
                            {failed.content}
                          </span>
                          <Button
                            size="small"
                            type="danger"
                            theme="borderless"
                            onClick={() => {
                              setFailedMessages((prev) => prev.filter((m) => m.id !== failed.id));
                              setInput(failed.content);
                              requestAnimationFrame(() => inputRef.current?.focus());
                            }}
                          >
                            重试
                          </Button>
                          <Button
                            size="small"
                            theme="borderless"
                            type="tertiary"
                            onClick={() => setFailedMessages((prev) => prev.filter((m) => m.id !== failed.id))}
                          >
                            忽略
                          </Button>
                        </div>
                      </SemiList.Item>
                    )}
                  />
                </div>
              )}
              {pendingNewMsgCount > 0 && (
                <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                  <Button
                    size="small"
                    theme="solid"
                    type="primary"
                    style={{ pointerEvents: 'auto' }}
                    onClick={() => {
                      virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
                      setPendingNewMsgCount(0);
                      if (activeConvId) {
                        void request.post(`/api/chat/conversations/${activeConvId}/read`, {}, { silent: true });
                        setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0, hasMentionUnread: false } : c)));
                      }
                    }}
                  >
                    有 {pendingNewMsgCount} 条新消息，点击查看
                  </Button>
                </div>
              )}
            </div>

            {/* Group members sidebar */}
            {!isQuick && activeConv.type === 'group' && showMembers && !showSearchPanel && !showMediaPanel && (
              <GroupMembersPanel
                conversationId={activeConv.id}
                currentUserId={currentUserId}
                conv={activeConv}
                onConvUpdate={(patch) => {
                  setConversations((prev) =>
                    prev.map((c) => c.id === activeConv.id ? { ...c, ...patch } : c),
                  );
                }}
              />
            )}


            {/* ⑤ 媒体库面板 */}
            {!isQuick && showMediaPanel && !showSearchPanel && !showMembers && (
              <div style={{ width: 320, borderLeft: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0, background: 'var(--semi-color-bg-1)' }}>
                <div style={{ padding: '12px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ flex: 1, fontSize: 13 }}>媒体文件</Text>
                  <Button size="small" theme="borderless" type="tertiary" icon={<X size={14} />} onClick={() => setShowMediaPanel(false)} />
                </div>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', gap: 8 }}>
                  <Button
                    size="small"
                    theme={mediaType === 'image' ? 'solid' : 'borderless'}
                    type={mediaType === 'image' ? 'primary' : 'tertiary'}
                    onClick={() => setMediaType('image')}
                  >
                    图片
                  </Button>
                  <Button
                    size="small"
                    theme={mediaType === 'file' ? 'solid' : 'borderless'}
                    type={mediaType === 'file' ? 'primary' : 'tertiary'}
                    onClick={() => setMediaType('file')}
                  >
                    文件
                  </Button>
                  <Button
                    size="small"
                    theme={mediaType === 'link' ? 'solid' : 'borderless'}
                    type={mediaType === 'link' ? 'primary' : 'tertiary'}
                    onClick={() => setMediaType('link')}
                  >
                    链接
                  </Button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                  <Spin spinning={mediaLoading && mediaItems.length === 0}>
                    {mediaItems.length === 0 && !mediaLoading && (() => {
                      const emptyDescMap: Record<typeof mediaType, string> = { image: '暂无图片消息', file: '暂无文件消息', link: '暂无链接消息' };
                      return <Empty description={emptyDescMap[mediaType]} imageStyle={{ width: 64 }} style={{ paddingTop: 40 }} />;
                    })()}
                    {mediaType === 'image' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                        {mediaItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => { void openImagePreview(item, mediaItems.filter((m) => m.type === 'image')); }}
                            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', aspectRatio: '1', overflow: 'hidden', borderRadius: 4 }}
                          >
                            <img
                              src={item.extra?.asset?.thumbnailUrl ?? item.content}
                              alt={item.extra?.asset?.name ?? '图片'}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {mediaType === 'file' && (
                      <SemiList
                        split={false}
                        dataSource={mediaItems}
                        renderItem={(item) => {
                          const asset = item.extra?.asset;
                          return (
                            <SemiList.Item
                              key={item.id}
                              style={{ padding: '8px 10px', background: 'var(--semi-color-bg-0)', border: '1px solid var(--semi-color-border)', borderRadius: 8, marginBottom: 8 }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 22, flexShrink: 0 }}>{getFileTypeIcon(asset?.name ?? '')}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <Text strong style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {asset?.name ?? '未知文件'}
                                  </Text>
                                  <Text type="tertiary" style={{ fontSize: 11 }}>
                                    {asset?.size ? formatFileSize(asset.size) : ''}
                                  </Text>
                                </div>
                                <Button
                                  size="small"
                                  theme="borderless"
                                  type="primary"
                                  onClick={() => { window.open(item.content, '_blank'); }}
                                >
                                  下载
                                </Button>
                              </div>
                            </SemiList.Item>
                          );
                        }}
                      />
                    )}
                    {mediaType === 'link' && (
                      <SemiList
                        split={false}
                        dataSource={mediaItems}
                        renderItem={(item) => {
                          const preview = item.extra?.linkPreview;
                          const urlMatch = preview?.url ?? (/(https?:\/\/[^\s]+)/.exec(item.content)?.[1] ?? item.content);
                          return (
                            <SemiList.Item key={item.id} style={{ padding: 0, marginBottom: 8, border: 'none' }}>
                              <a
                                href={urlMatch}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--semi-color-bg-0)', border: '1px solid var(--semi-color-border)', borderRadius: 8, textDecoration: 'none', color: 'inherit', alignItems: 'flex-start' }}
                              >
                                {preview?.image && (
                                  <img
                                    src={preview.image}
                                    alt=""
                                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                  />
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <Text strong style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {preview?.title ?? urlMatch}
                                  </Text>
                                  <Text type="tertiary" style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                                    {urlMatch}
                                  </Text>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                    {preview?.favicon && (
                                      <img src={preview.favicon} alt="" style={{ width: 12, height: 12, borderRadius: 2 }}
                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                      />
                                    )}
                                    <Text type="secondary" style={{ fontSize: 11 }}>{preview?.siteName ?? item.senderName}</Text>
                                    <Text type="tertiary" style={{ fontSize: 11, marginLeft: 'auto' }}>{formatDateTime(item.createdAt)}</Text>
                                  </div>
                                </div>
                              </a>
                            </SemiList.Item>
                          );
                        }}
                      />
                    )}
                    {mediaHasMore && (
                      <div style={{ textAlign: 'center', marginTop: 8 }}>
                        <Button
                          size="small"
                          type="tertiary"
                          theme="borderless"
                          loading={mediaLoading}
                          onClick={() => { if (activeConvId) void fetchMediaItems(activeConvId, mediaType, mediaPage + 1); }}
                        >
                          加载更多
                        </Button>
                      </div>
                    )}
                  </Spin>
                </div>
              </div>
            )}
          </div>

          <ImagePreview
            src={previewSrcList}
            visible={previewVisible}
            currentIndex={previewCurrentIndex}
            onChange={setPreviewCurrentIndex}
            onVisibleChange={(v) => {
              if (!v) {
                previewSessionRef.current += 1;
                setPreviewVisible(false);
                cleanupPreviewBlobs();
                setPreviewSrcList([]);
              }
            }}
            infinite
          />

          <Modal
            title="群公告历史"
            visible={announcementHistoryVisible}
            onCancel={() => setAnnouncementHistoryVisible(false)}
            footer={null}
            width={560}
          >
            <SemiList
              dataSource={announcementHistory}
              emptyContent={<Empty description="暂无公告历史" imageStyle={{ width: 72 }} style={{ padding: '20px 0' }} />}
              style={{ maxHeight: 420, overflowY: 'auto' }}
              renderItem={(item) => (
                <SemiList.Item
                  key={item.id}
                  main={(
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <Text strong style={{ fontSize: 12 }}>{item.extra?.announcementHistory?.operatorName ?? item.senderName ?? '系统'}</Text>
                        <Text type="tertiary" style={{ fontSize: 11 }}>{formatDateTime(item.createdAt)}</Text>
                      </div>
                      <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {item.extra?.announcementHistory?.announcement || '已清空群公告'}
                      </Text>
                    </>
                  )}
                  extra={isOwnerOfActiveGroup ? (
                    <Button
                      theme="borderless"
                      type="danger"
                      size="small"
                      onClick={() => handleDeleteAnnouncementHistory(item.id)}
                    >
                      删除
                    </Button>
                  ) : null}
                />
              )}
            />
          </Modal>

          {/* Input area */}
          <div style={{ padding: isQuick ? '6px 8px' : '4px 8px', borderTop: '1px solid var(--semi-color-border)' }}>
            {multiSelectMode ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', flexWrap: 'wrap' }}>
                <Text style={{ flex: 1, fontSize: 13, minWidth: 80 }}>
                  已选 <Text strong>{selectedMessageIds.length}</Text> 条消息
                </Text>
                <Button
                  size="small" type="primary" theme="light" icon={<Forward size={14} />}
                  disabled={selectedMessageIds.length === 0}
                  onClick={() => handleForwardSelected('individual')}
                >
                  逐条转发
                </Button>
                <Button
                  size="small" type="primary" icon={<Forward size={14} />}
                  disabled={selectedMessageIds.length === 0}
                  onClick={() => handleForwardSelected('merge')}
                >
                  合并转发
                </Button>
                <Button
                  size="small" type="primary" theme="light" icon={<Bookmark size={14} />}
                  disabled={selectedMessageIds.length === 0}
                  onClick={() => { void handleFavoriteSelected(); }}
                >
                  收藏
                </Button>
                <Button
                  size="small" type="danger" theme="light" icon={<Trash2 size={14} />}
                  disabled={selectedMessageIds.length === 0}
                  onClick={() => { void handleDeleteSelected(); }}
                >
                  删除
                </Button>
                <Button size="small" type="tertiary" onClick={handleExitMultiSelect}>取消多选</Button>
              </div>
            ) : (
              <>
            {replyTo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '4px 10px', background: 'var(--semi-color-fill-0)', borderRadius: 6, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                <CornerDownLeft size={12} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  回复 {replyTo.senderName}：{replyTo.type === 'image' ? '[图片]' : replyTo.type === 'file' ? `[文件] ${getAssetMeta(replyTo)?.name ?? ''}` : replyTo.content}
                </span>
                <Button size="small" theme="borderless" type="tertiary" onClick={() => setReplyTo(null)} style={{ padding: '0 4px', height: 'auto', minWidth: 'auto' }}>✕</Button>
              </div>
            )}

            {pendingImages.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                {pendingImages.map((item) => (
                  <div key={item.id} style={{ position: 'relative', width: 64, height: 64 }}>
                    <img
                      src={item.previewUrl}
                      alt={item.file.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }}
                    />
                    <Button
                      size="small"
                      theme="solid"
                      type="danger"
                      onClick={() => handleRemovePendingImage(item.id)}
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -6,
                        minWidth: 20,
                        height: 20,
                        padding: 0,
                        borderRadius: '50%',
                        lineHeight: '20px',
                      }}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {pendingFiles.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {pendingFiles.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      background: 'var(--semi-color-fill-0)',
                      borderRadius: 6,
                      border: '1px solid var(--semi-color-border)',
                      maxWidth: 220,
                      position: 'relative',
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{getFileTypeIcon(item.file.name)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--semi-color-text-3)' }}>{formatFileSize(item.file.size)}</div>
                    </div>
                    <Button
                      size="small"
                      theme="borderless"
                      type="danger"
                      onClick={() => handleRemovePendingFile(item.id)}
                      style={{ padding: '0 2px', height: 'auto', minWidth: 'auto', flexShrink: 0 }}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 1, alignItems: 'center' }}>
              <div ref={emojiContainerRef}>
                <Button
                  size="small" theme="borderless" type="tertiary"
                  icon={<Smile size={16} />}
                  title="表情"
                  onClick={() => {
                    if (emojiVisible) { setEmojiVisible(false); return; }
                    const rect = emojiContainerRef.current?.getBoundingClientRect();
                    if (rect) setEmojiAnchor({ top: rect.top, left: rect.left });
                    setEmojiVisible(true);
                  }}
                />
              </div>
              {emojiVisible && emojiAnchor && (
                <div
                  ref={emojiPickerRef}
                  style={{
                    position: 'fixed',
                    bottom: window.innerHeight - emojiAnchor.top + 4,
                    left: emojiAnchor.left,
                    zIndex: 9999,
                  }}
                >
                  <Picker
                    data={data}
                    onEmojiSelect={handleEmojiSelect}
                    theme="auto"
                    locale="zh"
                    previewPosition="none"
                    skinTonePosition="none"
                  />
                </div>
              )}

              <Tooltip content="选择图片">
                <Button
                  size="small" theme="borderless" type="tertiary"
                  icon={<ImagePlus size={16} />}
                  loading={uploading}
                  onClick={() => fileInputRef.current?.click()}
                />
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) handleSelectImages(files);
                  e.target.value = '';
                }}
              />
              <Tooltip content="发送文件">
                <Button
                  size="small" theme="borderless" type="tertiary"
                  icon={<Paperclip size={16} />}
                  loading={false}
                  onClick={() => fileAttachRef.current?.click()}
                />
              </Tooltip>
              <Tooltip content="发起投票">
                <Button
                  size="small" theme="borderless" type="tertiary"
                  icon={<BarChart3 size={16} />}
                  onClick={() => setShowVoteModal(true)}
                  disabled={!activeConvId}
                />
              </Tooltip>
              <input
                ref={fileAttachRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) handleSelectFile(files);
                  e.target.value = '';
                }}
              />
            </div>

            <div style={{ position: 'relative', flex: 1 }}>
              {mentionState && !mentionClosed && mentionCandidates.length > 0 && (
                <div
                  ref={mentionListRef}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 48,
                    bottom: 'calc(100% + 8px)',
                    zIndex: 30,
                    background: 'var(--semi-color-bg-0)',
                    border: '1px solid var(--semi-color-border)',
                    borderRadius: 8,
                    boxShadow: 'var(--semi-shadow-elevated)',
                    padding: 6,
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  {mentionCandidates.map((member, idx) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => insertMention(member)}
                      onMouseEnter={() => setMentionActiveIndex(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none',
                        background: idx === mentionActiveIndex ? 'var(--semi-color-fill-1)' : 'transparent',
                        padding: '6px 8px', textAlign: 'left', cursor: 'pointer', borderRadius: 6,
                        transition: 'background 0.1s',
                      }}
                    >
                      <UserAvatar name={member.nickname} avatar={member.avatar} size={26} />
                      <div style={{ minWidth: 0 }}>
                        <Text strong style={{ fontSize: 12 }}>{member.nickname}</Text>
                        <Text type="tertiary" style={{ fontSize: 11, display: 'block' }}>@{member.username}</Text>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {Object.values(typingUsers).length > 0 && (() => {
                const names = Object.values(typingUsers).map((u) => u.nickname);
                const label = names.length > 2
                  ? `${names[0]}等${names.length}人正在输入...`
                  : `${names.join('、')}正在输入...`;
                return (
                  <div style={{ fontSize: 11, color: 'var(--semi-color-text-3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          style={{
                            width: 4, height: 4, borderRadius: '50%',
                            background: 'var(--semi-color-text-3)',
                            display: 'inline-block',
                            animation: `chat-typing-bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
                          }}
                        />
                      ))}
                    </span>
                    {label}
                  </div>
                );
              })()}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); setMentionClosed(false); handleTyping(e.target.value); }}
                onKeyDown={handleKeyDown}
                onPaste={handleInputPaste}
                placeholder="输入消息…"
                rows={isQuick ? 2 : 3}
                style={{
                  width: '100%', resize: 'none', borderRadius: 8, padding: '8px 48px 8px 12px',
                  border: '1px solid var(--semi-color-border)',
                  background: 'var(--semi-color-bg-2)',
                  color: 'var(--semi-color-text-0)',
                  fontSize: 14, fontFamily: 'inherit', outline: 'none',
                  lineHeight: 1.5, boxSizing: 'border-box',
                }}
              />
              <Button
                theme="solid" type="primary"
                icon={<Send size={14} />}
                loading={sending}
                disabled={!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0}
                onClick={() => { void handleSend(); }}
                style={{
                  position: 'absolute', bottom: 8, right: 8,
                  borderRadius: 6, width: 32, height: 32, padding: 0,
                }}
              />
            </div>
            {!isQuick && (
              <Text type="tertiary" style={{ fontSize: 10, marginTop: 2, display: 'block', opacity: 0.7 }}>Enter 发送 · Shift+Enter 换行 · 支持粘贴图片</Text>
            )}
              </>
            )}
          </div>
        </div>
      ) : (
        !isQuick && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty
            description={<span>选择一个会话开始聊天，<br />或点击右上角「+」新建</span>}
            imageStyle={{ width: 100 }}
          />
        </div>
      )}
      <ForwardModal
        visible={forwardModalVisible}
        conversations={conversations}
        currentConvId={activeConvId}
        onConfirm={(targetIds) => { void handleForwardConfirm(targetIds); }}
        onCancel={() => { setForwardModalVisible(false); setForwardingMessageIds([]); }}
        mode={forwardingMode}
      />
      <VotePollModal
        visible={showVoteModal}
        onClose={() => setShowVoteModal(false)}
        onConfirm={handleCreateVote}
      />
      {/* Reaction emoji picker — fixed overlay */}
      {reactionPickerVisible && reactionPickerAnchor && (
        <div
          ref={reactionPickerRef}
          style={{
            position: 'fixed',
            bottom: window.innerHeight - reactionPickerAnchor.top + 4,
            right: reactionPickerAnchor.right,
            zIndex: 9999,
          }}
        >
          <Picker
            data={data}
            onEmojiSelect={(emoji: { native: string }) => {
              if (reactionTargetMsgId !== null) handleReaction(reactionTargetMsgId, emoji.native);
              setReactionPickerVisible(false);
            }}
            theme="auto"
            locale="zh"
            previewPosition="none"
            skinTonePosition="none"
          />
        </div>
      )}
      <ForwardedMessagesModal
        visible={forwardViewVisible}
        items={forwardViewItems}
        title={forwardViewTitle}
        onCancel={() => setForwardViewVisible(false)}
      />
      {favPreviewMsg && (() => {
        const conv = conversations.find((c) => c.id === favPreviewMsg.conversationId);
        const convName = conv?.type === 'direct' ? (conv.targetUser?.nickname ?? '私聊') : (conv?.name ?? '群聊');
        return (
          <Modal
            title={
              <div>
                <div>收藏的消息</div>
                <Text type="tertiary" style={{ fontSize: 12, fontWeight: 'normal' }}>{convName}</Text>
              </div>
            }
            visible={favPreviewVisible}
            onCancel={() => setFavPreviewVisible(false)}
            footer={
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button
                  type="tertiary"
                  theme="borderless"
                  icon={<Bookmark size={14} />}
                  onClick={() => {
                    void handleToggleFavorite(favPreviewMsg);
                    setFavPreviewVisible(false);
                  }}
                >
                  取消收藏
                </Button>
                <Button
                  type="primary"
                  icon={<Search size={14} />}
                  onClick={() => {
                    setFavPreviewVisible(false);
                    void openFavoriteMessage(favPreviewMsg);
                  }}
                >
                  定位消息
                </Button>
              </div>
            }
            width={520}
          >
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserAvatar name={favPreviewMsg.senderName ?? '未知'} avatar={favPreviewMsg.senderAvatar} size={32} />
              <div>
                <Text strong style={{ fontSize: 13, display: 'block' }}>{favPreviewMsg.senderName ?? '未知'}</Text>
                <Text type="tertiary" style={{ fontSize: 11 }}>{formatDateTime(favPreviewMsg.createdAt)}</Text>
              </div>
            </div>
            <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 8, padding: 12 }}>
              <MessageContent
                msg={favPreviewMsg}
                isSelf={false}
                onOpenForwardView={handleOpenForwardView}
              />
            </div>
          </Modal>
        );
      })()}

      {/* 聊天记录搜索弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={16} style={{ color: 'var(--semi-color-text-2)' }} />
            <span>聊天记录</span>
            <Text type="tertiary" style={{ fontSize: 12, marginLeft: 'auto' }}>{searchHasSearched ? `共 ${searchTotal} 条` : '未搜索'}</Text>
          </div>
        }
        visible={showSearchPanel}
        onCancel={resetSearchFilters}
        footer={null}
        width={900}
        bodyStyle={{ padding: 0, maxHeight: '80vh' }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', height: '100%', maxHeight: '80vh' }}>
          {/* 左列：搜索条件 */}
          <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            <Input
              size="small"
              prefix={<Search size={13} />}
              placeholder="搜索消息内容 / 文件名 / 发送人"
              value={msgSearch}
              onChange={setMsgSearch}
              onEnterPress={() => { void executeSearch(1); }}
              showClear
            />

            <Select
              multiple
              showClear
              placeholder="消息类别（可多选）"
              value={searchTypeFilters}
              onChange={(val) => setSearchTypeFilters(((val as ChatMessage['type'][]) ?? []))}
              optionList={CHAT_MESSAGE_TYPE_OPTIONS}
              maxTagCount={2}
            />

            <Select
              showClear
              filter
              placeholder="发送人"
              value={searchSenderId}
              onChange={(val) => setSearchSenderId(val ? Number(val) : undefined)}
              optionList={senderOptions}
            />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { value: 'today', label: '今天' },
                { value: '7d', label: '近7天' },
                { value: '30d', label: '近30天' },
              ].map((item) => (
                <Button
                  key={item.value}
                  size="small"
                  theme={searchDatePreset === item.value ? 'solid' : 'borderless'}
                  type={searchDatePreset === item.value ? 'primary' : 'tertiary'}
                  onClick={() => applyDatePreset(item.value as SearchDatePreset)}
                >
                  {item.label}
                </Button>
              ))}
              {searchTimeRange && (
                <Button size="small" theme="borderless" type="tertiary" onClick={() => applyDatePreset('')}>清空时间</Button>
              )}
            </div>

            <DatePicker
              type="dateTimeRange"
              placeholder={['开始时间', '结束时间']}
              value={searchTimeRange ?? undefined}
              onChange={(val) => {
                setSearchDatePreset('');
                setSearchTimeRange(val ? (val as [Date, Date]) : null);
              }}
              style={{ width: '100%' }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="primary" loading={searchLoading} icon={<Search size={14} />} onClick={() => { void executeSearch(1); }}>查询</Button>
              <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={resetSearchFilters}>重置</Button>
            </div>
          </div>

          {/* 右列：搜索结果 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, minHeight: 0 }}>
            {!searchHasSearched && (
              <Empty description="输入关键词或设置筛选条件后开始搜索" style={{ paddingTop: 48 }} imageStyle={{ width: 72 }} />
            )}
            {searchHasSearched && searchResults.length === 0 && !searchLoading && (
              <Empty description="没有找到符合条件的消息" style={{ paddingTop: 48 }} imageStyle={{ width: 72 }} />
            )}
            <SemiList
              split={false}
              dataSource={searchResults}
              renderItem={(item) => {
                const typeLabel = CHAT_MESSAGE_TYPE_OPTIONS.find((option) => option.value === item.message.type)?.label ?? item.message.type;
                return (
                  <SemiList.Item
                    key={item.message.id}
                    style={{ padding: 0, marginBottom: 10, border: 'none' }}
                  >
                    <div
                      style={{
                        width: '100%', textAlign: 'left', border: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)', borderRadius: 8,
                        padding: '10px 12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <Tag size="small" color="light-blue">{typeLabel}</Tag>
                          <Text strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.message.senderName ?? '未知发送人'}
                          </Text>
                        </div>
                        <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(item.message.createdAt)}</Text>
                      </div>
                      <Text style={{ display: 'block', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {item.snippet}
                      </Text>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => {
                            setShowSearchPanel(false);
                            void jumpToSearchResult(item);
                          }}
                        >
                          定位到聊天位置
                        </Button>
                      </div>
                    </div>
                  </SemiList.Item>
                );
              }}
            />

            {searchHasSearched && searchResults.length < searchTotal && (
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <Button
                  size="small"
                  type="tertiary"
                  theme="borderless"
                  loading={searchLoading}
                  onClick={() => { void executeSearch(searchPage + 1); }}
                >
                  加载更多结果
                </Button>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
