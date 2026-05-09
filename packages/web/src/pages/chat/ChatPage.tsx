import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Input, Button, Badge, Typography, Empty, Spin, Toast, Tooltip, Modal, Tag, Select, DatePicker, Dropdown, ImagePreview,
} from '@douyinfe/semi-ui';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import {
  Search, MessageSquarePlus, Send, CornerDownLeft, RotateCcw, Smile, ImagePlus, Users,
  Pin, Star, X, Paperclip, Bookmark, History, Forward, Trash2, ListFilter, BellOff, Images, AlertCircle,
} from 'lucide-react';
import { useWebSocket, sendWsMessage } from '@/hooks/useWebSocket';
import { useAuth } from '@/hooks/useAuth';
import { request } from '@/utils/request';
import { formatDateTime, formatConvTime, formatDateTimeForApi } from '@/utils/date';
import { formatFileSize, getFileTypeIcon, fetchProtectedFile } from '@/utils/file-utils';
import type {
  ChatConversation, ChatMessage, WsMessage, ChatLinkPreview, ChatAssetMeta, ChatMessageExtra,
  ChatGroupMember, ChatMessageSearchItem, ChatMessageSearchResult, ChatMessageContext,
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
import { MessageBubble } from './components/MessageBubble';

import { MessageContent } from './components/MessageContent';

const { Text, Title } = Typography;

export default function ChatPage() {
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
  const [convSearch, setConvSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [page, setPage] = useState(1);
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
  const [leftPaneMode, setLeftPaneMode] = useState<'conversations' | 'favorites'>('conversations');
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
  const [favPreviewVisible, setFavPreviewVisible] = useState(false);
  const [favPreviewMsg, setFavPreviewMsg] = useState<ChatMessage | null>(null);
  const [contextMode, setContextMode] = useState<{ anchorMessageId: number; keyword: string } | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<number, { nickname: string; timer: ReturnType<typeof setTimeout> }>>({});
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [failedMessages, setFailedMessages] = useState<FailedMessage[]>([]);
  const [showMediaPanel, setShowMediaPanel] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'file'>('image');
  const [mediaItems, setMediaItems] = useState<ChatMessage[]>([]);
  const [mediaPage, setMediaPage] = useState(1);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSrcList, setPreviewSrcList] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const previewSessionRef = useRef(0);
  const previewBlobUrlsRef = useRef<string[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAttachRef = useRef<HTMLInputElement>(null);
  const emojiContainerRef = useRef<HTMLDivElement>(null);
  const pendingImagesRef = useRef<PendingImage[]>([]);

  // 点击 emoji 选择器外部时关闭
  useEffect(() => {
    if (!emojiVisible) return;
    const handler = (e: MouseEvent) => {
      if (emojiContainerRef.current && !emojiContainerRef.current.contains(e.target as Node)) {
        setEmojiVisible(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emojiVisible]);

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

  const isNearBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const fetchConversations = useCallback(async () => {
    setLoadingConvs(true);
    const res = await request.get<ChatConversation[]>('/api/chat/conversations', { silent: true });
    setLoadingConvs(false);
    if (res.code === 0 && res.data) setConversations(res.data);
  }, []);

  useEffect(() => { void fetchConversations(); }, [fetchConversations]);

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
    setPage(1);
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

  const fetchMessages = useCallback(async (convId: number, p = 1) => {
    const el = messagesContainerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;
    setLoadingMsgs(true);
    const res = await request.get<{ list: ChatMessage[]; total: number; page: number; pageSize: number }>(
      `/api/chat/conversations/${convId}/messages?page=${p}&pageSize=30`,
      { silent: true },
    );
    setLoadingMsgs(false);
    if (res.code === 0 && res.data) {
      const newMsgs = [...res.data.list].reverse();
      if (p === 1) {
        setMessages(newMsgs);
        setPage(1);
        setPendingNewMsgCount(0);
        setContextMode(null);
      } else {
        setMessages((prev) => [...newMsgs, ...prev]);
        setPage(p);
        requestAnimationFrame(() => {
          const box = messagesContainerRef.current;
          if (!box) return;
          const delta = box.scrollHeight - prevScrollHeight;
          box.scrollTop = prevScrollTop + delta;
        });
      }
      setHasMore(res.data.list.length >= 30);
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
    await fetchMessages(conv.id, 1);
    await request.post(`/api/chat/conversations/${conv.id}/read`, {}, { silent: true });
    setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, unreadCount: 0 } : c));
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [activeConvId, fetchMessages, input, loadDraft, saveDraft]);

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
    return msgRes.code === 0;
  }, [activeConvId]);

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
    return msgRes.code === 0;
  }, [activeConvId]);

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
      }
    }

    if (imagesToSend.length > 0) {
      for (const item of imagesToSend) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await sendImageFile(item.file);
        if (!ok) failedImageCount += 1;
      }
    }

    if (filesToSend.length > 0) {
      for (const item of filesToSend) {
        // eslint-disable-next-line no-await-in-loop
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
  }, [activeConvId, fetchLinkPreview, input, pendingFiles, pendingImages, replyTo, saveDraft, selectedMentions, sendFileMessage, sendImageFile, sending]);

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

  const scrollToMessage = useCallback((id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s ease';
      el.style.background = 'var(--semi-color-primary-light-hover)';
      setTimeout(() => { el.style.background = ''; }, 1200);
    }
  }, []);

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
      // eslint-disable-next-line no-await-in-loop
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

  const handlePickReactionEmoji = useCallback((_messageId: number, _e: React.MouseEvent) => {
    // Quick emoji bar in the right-click menu covers the main use case.
    // Full emoji picker can be added as a future enhancement.
  }, []);

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
    setPage(1);
    setContextMode({ anchorMessageId: res.data.anchorMessageId, keyword: msgSearch.trim() || item.snippet });
    setTimeout(() => scrollToMessage(res.data.anchorMessageId), 80);
  }, [activeConvId, msgSearch, scrollToMessage]);

  const restoreLatestMessages = useCallback(async () => {
    if (!activeConvId) return;
    await fetchMessages(activeConvId, 1);
  }, [activeConvId, fetchMessages]);

  const fetchMediaItems = useCallback(async (convId: number, type: 'image' | 'file', p = 1) => {
    setMediaLoading(true);
    const qs = new URLSearchParams({ types: type, page: String(p), pageSize: '30' });
    const res = await request.get<{ list: Array<{ message: ChatMessage }> }>(
      `/api/chat/conversations/${convId}/messages/search?${qs.toString()}`,
      { silent: true },
    );
    setMediaLoading(false);
    if (res.code === 0 && res.data) {
      const items = res.data.list.map((item) => item.message);
      if (p === 1) {
        setMediaItems(items);
      } else {
        setMediaItems((prev) => [...prev, ...items]);
      }
      setMediaPage(p);
      setMediaHasMore(items.length >= 30);
    }
  }, []);

  useEffect(() => {
    if (!showMediaPanel || !activeConvId) return;
    void fetchMediaItems(activeConvId, mediaType, 1);
  }, [showMediaPanel, activeConvId, mediaType, fetchMediaItems]);

  // ① 自动上拉加载历史消息
  useEffect(() => {
    const isLocalSearchFallback = Boolean(msgSearch.trim()) && !(showSearchPanel && searchHasSearched);
    if (!hasMore || loadingMsgs || !activeConvId || isLocalSearchFallback || contextMode) return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMsgs && hasMore) {
          void fetchMessages(activeConvId, page + 1);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeConvId, hasMore, loadingMsgs, page, msgSearch, showSearchPanel, searchHasSearched, contextMode, fetchMessages]);

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
      const shouldAutoRead = msg.conversationId === activeConvId && (isOwnMsg || isNearBottom());
      if (msg.conversationId === activeConvId) {
        setMessages((prev) => [...prev, msg]);
        if (shouldAutoRead) {
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
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
  }, [activeConvId, currentUserId, fetchConversations, isNearBottom, refreshGroupAvatarMembers]);

  const handleMessagesScroll = useCallback(() => {
    if (!activeConvId) return;
    if (!isNearBottom()) return;
    if (pendingNewMsgCount > 0) setPendingNewMsgCount(0);
    request.post(`/api/chat/conversations/${activeConvId}/read`, {}, { silent: true }).catch(() => {});
    setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c)));
  }, [activeConvId, isNearBottom, pendingNewMsgCount]);

  useWebSocket(handleWsMessage);

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
  const galleryImages = messages.filter((m) => m.type === 'image' && !m.isRecalled);
  const useLocalSearchFallback = Boolean(msgSearch.trim()) && !(showSearchPanel && searchHasSearched);
  const visibleMessages = messages.filter((m) => !currentUserId || !(m.extra?.hiddenFor ?? []).includes(currentUserId));
  const displayMessages = useLocalSearchFallback
    ? visibleMessages.filter((m) => {
      const keyword = msgSearch.toLowerCase();
      return (m.content ?? '').toLowerCase().includes(keyword) || (m.senderName ?? '').toLowerCase().includes(keyword);
    })
    : visibleMessages;

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

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', minHeight: 500, border: '1px solid var(--semi-color-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--semi-color-bg-1)' }}>

      {/* Left: conversation list */}
      <div style={{ width: 280, borderRight: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
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
        </div>

        {showNewChat && (
          <div style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
            <NewChatPanel
              onSelectUser={handleNewDirectChat}
              onGroupCreated={handleGroupCreated}
              onClose={() => setShowNewChat(false)}
            />
          </div>
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
            type={leftPaneMode === 'favorites' ? 'warning' : 'tertiary'}
            icon={<Bookmark size={13} />}
            onClick={() => setLeftPaneMode('favorites')}
          >
            收藏
          </Button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Spin spinning={loadingConvs}>
            {leftPaneMode === 'conversations' && filteredConvs.length === 0 && !loadingConvs && (
              <Empty description="暂无会话" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />
            )}
            {leftPaneMode === 'favorites' && favoriteMessages.length === 0 && !loadingConvs && (
              <Empty description="暂无收藏消息" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />
            )}
            {leftPaneMode === 'conversations' && filteredConvs.map((conv) => {
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
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => { void handleSelectConv(conv); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setLeftPaneContextMenu({ x: e.clientX, y: e.clientY, type: 'conversation', conv });
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    cursor: 'pointer', width: '100%', textAlign: 'left', border: 'none',
                    background: isActive ? 'var(--semi-color-primary-light-default)' : 'transparent',
                    borderLeft: isActive ? '3px solid var(--semi-color-primary)' : '3px solid transparent',
                  }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--semi-color-fill-0)'; }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                    {conv.unreadCount > 0 ? (
                      <Badge count={conv.unreadCount} overflowCount={99} dot={false}>
                        {avatarNode}
                      </Badge>
                    ) : (
                      avatarNode
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
                          {isPinned && <Pin size={10} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />}
                          {isStarred && <Star size={10} style={{ color: '#facc15', flexShrink: 0 }} />}
                          {isMuted && <BellOff size={10} style={{ color: 'var(--semi-color-text-3)', flexShrink: 0 }} />}
                          <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </Text>
                        </div>
                        {lastMsg && (
                          <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>
                            {formatConvTime(lastMsg.createdAt)}
                          </Text>
                        )}
                      </div>
                      <Text type="tertiary" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                        {lastMsgText}
                      </Text>
                    </div>
                </button>
              );
            })}
            {leftPaneMode === 'favorites' && favoriteMessages.map((msg) => {
              const conv = conversations.find((item) => item.id === msg.conversationId);
              const convName = conv?.type === 'direct' ? (conv.targetUser?.nickname ?? '私聊') : (conv?.name ?? '群聊');
              return (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => {
                    setFavPreviewMsg(msg);
                    setFavPreviewVisible(true);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setLeftPaneContextMenu({ x: e.clientX, y: e.clientY, type: 'favorite', msg });
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '10px 12px', cursor: 'pointer' }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <Text strong style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{convName}</Text>
                      <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(msg.createdAt)}</Text>
                    </div>
                    <Text type="tertiary" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getMessageSummary(msg)}
                    </Text>
                </button>
              );
            })}
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
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            {activeConv.type === 'direct' && activeConv.targetUser && (
              <UserAvatar name={activeConv.targetUser.nickname} avatar={activeConv.targetUser.avatar} size={32} />
            )}
            {activeConv.type === 'group' && (
              <GroupGridAvatar name={activeConv.name ?? '群聊'} size={32} members={groupAvatarMap[activeConv.id]} />
            )}
            <Title heading={6} style={{ margin: 0, flex: 1 }}>
              {activeConv.type === 'direct' ? (activeConv.targetUser?.nickname ?? '未知用户') : (activeConv.name ?? '群聊')}
            </Title>
            <Input
              size="small"
              prefix={<Search size={12} />}
              placeholder="搜索消息"
              value={msgSearch}
              onChange={setMsgSearch}
              onEnterPress={() => { void executeSearch(1); }}
              showClear
              style={{ width: 240 }}
            />
            <Tooltip content="执行搜索">
              <Button
                size="small"
                theme="solid"
                type="primary"
                icon={<Search size={14} />}
                loading={searchLoading}
                onClick={() => { void executeSearch(1); }}
              />
            </Tooltip>
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
            <Tooltip content={showSearchPanel ? '关闭搜索面板' : '高级筛选'}>
              <Button
                size="small"
                theme="borderless"
                type={showSearchPanel ? 'primary' : 'tertiary'}
                icon={<ListFilter size={15} />}
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
              <Tooltip content={showMembers ? '关闭成员面板' : '查看群成员'}>
                <Button
                  size="small" theme="borderless" type={showMembers ? 'primary' : 'tertiary'}
                  icon={<Users size={15} />}
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
          </div>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Messages */}
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}
            >
              {pinnedMessages.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)' }}>
                  <Text strong style={{ fontSize: 12 }}><Pin size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />置顶消息</Text>
                  {pinnedMessages.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => scrollToMessage(item.id)}
                      style={{ border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer' }}
                    >
                      <Text type="tertiary" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getMessageSummary(item)}
                      </Text>
                    </button>
                  ))}
                </div>
              )}
              {contextMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)' }}>
                  <Text style={{ flex: 1, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                    当前正在查看搜索定位结果：{contextMode.keyword}
                  </Text>
                  <Button size="small" theme="borderless" type="primary" onClick={() => { void restoreLatestMessages(); }}>
                    返回最新消息
                  </Button>
                </div>
              )}
              {hasMore && !useLocalSearchFallback && !contextMode && (
                <div
                  ref={loadMoreSentinelRef}
                  style={{ textAlign: 'center', marginBottom: 8, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {loadingMsgs && <Spin size="small" />}
                </div>
              )}
              <Spin spinning={loadingMsgs && messages.length === 0}>
                {displayMessages.length === 0 && !loadingMsgs && (
                  <Empty description="发送第一条消息吧" style={{ margin: 'auto' }} imageStyle={{ width: 80 }} />
                )}
                {displayMessages.map((msg, index) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isSelf={msg.senderId === currentUserId}
                    onReply={setReplyTo}
                    onRecall={handleRecall}
                    onOpenImage={(imageMsg) => { void openImagePreview(imageMsg, galleryImages); }}
                    shouldShowTime={shouldDisplayMessageTime(msg, displayMessages[index + 1])}
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
                  />
                ))}
                {/* ⑥ 发送失败重试 */}
                {failedMessages.filter((m) => m.convId === activeConvId).map((failed) => (
                  <div
                    key={failed.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px',
                      background: 'var(--semi-color-danger-light-default)',
                      border: '1px solid var(--semi-color-danger-light-active)',
                      borderRadius: 8, margin: '4px 0',
                    }}
                  >
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
                ))}
                <div ref={messagesEndRef} />
              </Spin>
              {pendingNewMsgCount > 0 && (
                <div style={{ position: 'sticky', bottom: 10, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                  <Button
                    size="small"
                    theme="solid"
                    type="primary"
                    style={{ pointerEvents: 'auto' }}
                    onClick={() => {
                      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                      setPendingNewMsgCount(0);
                      if (activeConvId) {
                        void request.post(`/api/chat/conversations/${activeConvId}/read`, {}, { silent: true });
                        setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c)));
                      }
                    }}
                  >
                    有 {pendingNewMsgCount} 条新消息，点击查看
                  </Button>
                </div>
              )}
            </div>

            {/* Group members sidebar */}
            {activeConv.type === 'group' && showMembers && !showSearchPanel && !showMediaPanel && (
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

            {showSearchPanel && (
              <div style={{ width: 380, borderLeft: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0, background: 'var(--semi-color-bg-1)' }}>
                <div style={{ padding: '12px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ flex: 1, fontSize: 13 }}>消息搜索</Text>
                  <Text type="tertiary" style={{ fontSize: 12 }}>{searchHasSearched ? `共 ${searchTotal} 条` : '未搜索'}</Text>
                  <Button size="small" theme="borderless" type="tertiary" icon={<X size={14} />} onClick={() => setShowSearchPanel(false)} />
                </div>

                <div style={{ padding: 12, borderBottom: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
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

                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                  {!searchHasSearched && (
                    <Empty description="输入关键词或设置筛选条件后开始搜索" style={{ paddingTop: 48 }} imageStyle={{ width: 72 }} />
                  )}
                  {searchHasSearched && searchResults.length === 0 && !searchLoading && (
                    <Empty description="没有找到符合条件的消息" style={{ paddingTop: 48 }} imageStyle={{ width: 72 }} />
                  )}
                  {searchResults.map((item) => {
                    const typeLabel = CHAT_MESSAGE_TYPE_OPTIONS.find((option) => option.value === item.message.type)?.label ?? item.message.type;
                    return (
                      <button
                        key={item.message.id}
                        type="button"
                        onClick={() => { void jumpToSearchResult(item); }}
                        style={{
                          width: '100%', textAlign: 'left', border: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-0)', borderRadius: 8,
                          padding: '10px 12px', marginBottom: 10, cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--semi-color-fill-0)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--semi-color-bg-0)'; }}
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
                      </button>
                    );
                  })}

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
            )}

            {/* ⑤ 媒体库面板 */}
            {showMediaPanel && !showSearchPanel && !showMembers && (
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
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                  <Spin spinning={mediaLoading && mediaItems.length === 0}>
                    {mediaItems.length === 0 && !mediaLoading && (
                      <Empty
                        description={`暂无${mediaType === 'image' ? '图片' : '文件'}消息`}
                        imageStyle={{ width: 64 }}
                        style={{ paddingTop: 40 }}
                      />
                    )}
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {mediaItems.map((item) => {
                          const asset = item.extra?.asset;
                          return (
                            <div
                              key={item.id}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--semi-color-bg-0)', border: '1px solid var(--semi-color-border)', borderRadius: 8 }}
                            >
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
                          );
                        })}
                      </div>
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
            {announcementHistory.length === 0 ? (
              <Empty description="暂无公告历史" imageStyle={{ width: 72 }} style={{ padding: '20px 0' }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto' }}>
                {announcementHistory.map((item) => (
                  <div key={item.id} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <Text strong style={{ fontSize: 12 }}>{item.extra?.announcementHistory?.operatorName ?? item.senderName ?? '系统'}</Text>
                      <Text type="tertiary" style={{ fontSize: 11 }}>{formatDateTime(item.createdAt)}</Text>
                    </div>
                    <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {item.extra?.announcementHistory?.announcement || '已清空群公告'}
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </Modal>

          {/* Input area */}
          <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--semi-color-border)' }}>
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
                  size="small" type="warning" theme="light" icon={<Bookmark size={14} />}
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
            <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
              <div ref={emojiContainerRef} style={{ position: 'relative' }}>
                <Button
                  size="small" theme="borderless" type="tertiary"
                  icon={<Smile size={16} />}
                  title="表情"
                  onClick={() => setEmojiVisible((v) => !v)}
                />
                {emojiVisible && (
                  <div
                    style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 1000 }}
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
              </div>

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
                rows={3}
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
            <Text type="tertiary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>Enter 发送 · Shift+Enter 换行 · 支持粘贴图片</Text>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
    </div>
  );
}
