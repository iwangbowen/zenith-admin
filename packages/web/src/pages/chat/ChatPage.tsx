import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Empty, Toast, ImagePreview } from '@douyinfe/semi-ui';
import type { VirtuosoHandle } from 'react-virtuoso';

import { BadgeCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { chatContract } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import FilePreviewModal from '@/components/FilePreviewModal';
import type { ChatConversation, ChatMessage, ChatMessageExtra, ChatGroupMember, ChatMessageSearchItem, ChatMessageContext, ChatReadState } from '@zenith/shared/chat';
import type { Channel } from '@zenith/shared/messaging';
import './ChatPage.css';
import type { PendingImage, PendingFile, SearchDatePreset, FailedMessage, UploadingItem, MessageReadReceipt, LeftPaneMode } from './types';
import { UserAvatar } from '@/components/UserAvatar';
import { GroupMembersPanel } from './components/GroupMembersPanel';
import { ForwardModal } from './components/ForwardModal';
import { ForwardedMessagesModal } from './components/ForwardedMessagesModal';
import { VotePollModal } from './components/VotePollModal';
import { ChannelMessageView } from './components/ChannelMessageView';
import { JoinInviteModal } from './components/JoinInviteModal';

import WorkflowApprovalDetailSheet from '@/components/workflow/WorkflowApprovalDetailSheet';
import { usePermission } from '@/hooks/usePermission';
import { useQueryClient } from '@tanstack/react-query';
import { useAddChatCustomEmoji, useChatGroupMembers, useChatJoinRequests } from '@/hooks/queries/chat';
import type { LeftPaneContextMenuState } from './types';
import {
  VIRTUOSO_FIRST_INDEX_BUFFER, computeLeftListModel,
  getRootStyle, markCardDoneLocal,
} from './utils-state';
import { useOverlayDismiss } from './hooks/useOverlayDismiss';
import { useExportChat } from './hooks/useExportChat';
import { useChannelsAndDiscover } from './hooks/useChannelsAndDiscover';
import { useImagePreview } from './hooks/useImagePreview';
import { useConversationExtras } from './hooks/useConversationExtras';
import { useCardAndCall } from './hooks/useCardAndCall';
import { useMessagesLoader } from './hooks/useMessagesLoader';
import { useChatDrafts } from './hooks/useChatDrafts';
import { useConversationSelection } from './hooks/useConversationSelection';
import { useSendMedia } from './hooks/useSendMedia';
import { useComposerActions } from './hooks/useComposerActions';
import { useMessageActions } from './hooks/useMessageActions';
import { useConversationSearch } from './hooks/useConversationSearch';
import { useMediaLibrary } from './hooks/useMediaLibrary';
import { useChatWebSocket } from './hooks/useChatWebSocket';
import { useGroupAvatars } from './hooks/useGroupAvatars';
import { useMuteState } from './hooks/useMuteState';
import { useMentionInput } from './hooks/useMentionInput';
import { useNotifyPrefs } from './hooks/useNotifyPrefs';
import { useFilePreview } from './hooks/useFilePreview';
import { ChatLeftPane } from './components/ChatLeftPane';
import { ChatDetailHeader } from './components/ChatDetailHeader';
import { ChatMessageList, type MessageBubbleHandlers } from './components/ChatMessageList';
import { ChatComposer } from './components/ChatComposer';
import { MediaPanel } from './components/MediaPanel';
import { AnnouncementHistoryModal } from './components/AnnouncementHistoryModal';
import { DiscoverChannelsModal } from './components/DiscoverChannelsModal';
import { FavoriteMessageModal } from './components/FavoriteMessageModal';
import { MessageSearchModal } from './components/MessageSearchModal';

// emoji-mart（~490KB 含全量表情元数据）仅在用户首次打开表情回应浮层时才加载
const ReactionPickerOverlay = lazy(() => import('./components/ReactionPickerOverlay').then((m) => ({ default: m.ReactionPickerOverlay })));

/** 稳定空数组：避免群成员查询无数据时每次渲染都产出新引用 */
const EMPTY_GROUP_MEMBERS: ChatGroupMember[] = [];

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
  const navigate = useNavigate();
  const [cardSheet, setCardSheet] = useState<{ instanceId: number; taskId: number | null; action: 'approve' | 'reject' | null; messageId?: number } | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [discoverVisible, setDiscoverVisible] = useState(false);
  const [discoverKeyword, setDiscoverKeyword] = useState('');
  // 发现频道搜索：输入 300ms 防抖；清空/打开时立即生效
  const [debouncedDiscoverKeyword] = useDebouncedValue(discoverKeyword.trim(), {
    wait: (d) => (d.store.state.lastArgs?.[0] ? 300 : 0),
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [emojiVisible, setEmojiVisible] = useState(false);

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
  const [readStates, setReadStates] = useState<ChatReadState[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(() => new Set());
  const [lastSeenMap, setLastSeenMap] = useState<Record<number, string | null>>({});
  const notifyPrefs = useNotifyPrefs();
  const [selectedMentions, setSelectedMentions] = useState<Array<{ userId: number; nickname: string }>>([]);
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('conversations');
  const [globalSearchKeyword, setGlobalSearchKeyword] = useState('');
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState<ChatMessageSearchItem[]>([]);
  const [globalSearchTotal, setGlobalSearchTotal] = useState(0);
  const [globalSearchPage, setGlobalSearchPage] = useState(1);
  const [globalSearchHasSearched, setGlobalSearchHasSearched] = useState(false);
  const [globalSearchConvNames, setGlobalSearchConvNames] = useState<Record<string, string>>({});
  const [favoriteMessages, setFavoriteMessages] = useState<ChatMessage[]>([]);
  const [leftPaneContextMenu, setLeftPaneContextMenu] = useState<LeftPaneContextMenuState | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [announcementHistoryVisible, setAnnouncementHistoryVisible] = useState(false);
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
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [failedMessages, setFailedMessages] = useState<FailedMessage[]>([]);
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);
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
  const { filePreview, openFilePreview, closeFilePreview } = useFilePreview();

  const previewSessionRef = useRef(0);
  const previewBlobUrlsRef = useRef<string[]>([]);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isAtBottomRef = useRef(true);
  const showMediaPanelRef = useRef(showMediaPanel);
  showMediaPanelRef.current = showMediaPanel;
  const mediaTypeRef = useRef(mediaType);
  mediaTypeRef.current = mediaType;
  const activeConvIdRef = useRef(activeConvId);
  activeConvIdRef.current = activeConvId;
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_FIRST_INDEX_BUFFER);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiContainerRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  const wsHasConnectedRef = useRef(false);
  const wsDisconnectedSinceReadyRef = useRef(false);

  useOverlayDismiss({
    emojiVisible, setEmojiVisible, emojiContainerRef, emojiPickerRef, reactionPickerVisible, setReactionPickerVisible,
    reactionPickerRef, pendingImages, pendingImagesRef,
  });

  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const currentUserNickname = authUser?.nickname ?? authUser?.username ?? '我';
  const { hasPermission } = usePermission();

  const { exportingChat, handleExportChat } = useExportChat();

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null;

  // 群成员是服务端状态，交给 Query 统一持有：GroupMembersPanel 用的是同一个缓存条目，
  // 因此加人/踢人/转让群主等 mutation 失效后，本页的 @提及候选、群主判定会一起刷新。
  // 此前这里另存了一份 useState 副本，只在切换会话时拉取，面板改完成员后本页仍是旧数据。
  const groupMembersQuery = useChatGroupMembers(
    activeConvId ?? undefined,
    activeConv?.type === 'group',
  );
  const activeGroupMembers = groupMembersQuery.data ?? EMPTY_GROUP_MEMBERS;

  // 待审批入群申请：群主/管理员在群信息按钮上看到角标，无需打开面板才发现
  const canManageActiveGroup = activeConv?.type === 'group'
    && (activeConv.myRole === 'owner' || activeConv.myRole === 'admin');
  const joinRequestsQuery = useChatJoinRequests(activeConvId ?? undefined, canManageActiveGroup);
  const pendingJoinRequestCount = canManageActiveGroup ? (joinRequestsQuery.data?.length ?? 0) : 0;

  // 置顶消息是会话级共享操作：群聊仅群主/管理员可执行，单聊双方均可
  const canPinInActiveConv = activeConv?.type !== 'group' || canManageActiveGroup;

  const queryClient = useQueryClient();

  // 未读分隔线：进入会话时按 unreadCount 定位首条未读消息
  const [unreadDivider, setUnreadDivider] = useState<{ convId: number; messageId: number } | null>(null);

  // 已归档会话折叠分组：是否展开查看归档列表
  const [showArchived, setShowArchived] = useState(false);

  // 邀请链接落地（?invite=TOKEN）
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // 收藏表情
  const addEmojiMutation = useAddChatCustomEmoji();

  const muteState = useMuteState(activeConv);

  const mention = useMentionInput({ activeConv, input, inputRef, activeGroupMembers, currentUserId });

  const {
    fetchConversations, handleUnsubscribeChannel, openDiscover, discoverList,
    handleSubscribeChannel,
  } = useChannelsAndDiscover({
    discoverVisible, debouncedDiscoverKeyword, setLoadingConvs, setConversations, setChannels,
    setActiveChannelId, setDiscoverKeyword, setDiscoverVisible,
  });

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

  // 读取 URL ?invite= 邀请令牌，弹出入群确认
  useEffect(() => {
    if (isQuick) return;
    const invite = searchParams.get('invite');
    if (!invite) return;
    setInviteToken(invite);
    setSearchParams((prev) => { prev.delete('invite'); return prev; }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isQuick]);

  const { cleanupPreviewBlobs, openImagePreview } = useImagePreview({
    previewSessionRef, previewBlobUrlsRef, setPreviewSrcList, setPreviewCurrentIndex, setPreviewVisible,
  });

  const {
    fetchFavoriteMessages, announcementHistory, isOwnerOfActiveGroup, handleDeleteAnnouncementHistory, openFavoriteMessage,
    computeReadReceipt,
  } = useConversationExtras({
    activeConvId, announcementHistoryVisible, activeConv, activeGroupMembers, currentUserId, conversations,
    readStates, setPinnedMessages, setFavoriteMessages, setLeftPaneMode, setActiveConvId, setMessages,
    setHasMore, setOldestMsgId, setContextMode, setReadStates, setOnlineUserIds, setLastSeenMap,
  });

  const { handleOpenWorkflowFromCard, handleCardAction, handleStartCall } = useCardAndCall({
    activeConv, navigate, setCardSheet,
  });

  const { fetchMessages } = useMessagesLoader({
    leftPaneMode, fetchFavoriteMessages, setLoadingMsgs, setMessages, setOldestMsgId, setFirstItemIndex,
    setPendingNewMsgCount, setContextMode, setHasMore,
  });

  const { saveDraft, loadDraft } = useChatDrafts({ setDraftsMap });

  const { handleSelectConv, handleNewDirectChat, handleGroupCreated, appendMessageOnce } = useConversationSelection({
    activeConvId, input, currentUserId, onConvChange, saveDraft, loadDraft,
    fetchMessages, fetchConversations, virtuosoRef, showMediaPanelRef, mediaTypeRef, activeConvIdRef,
    setActiveConvId, setActiveChannelId, setReplyTo, setSelectedMentions, setPendingImages, setPendingFiles,
    setLeftPaneMode, setAnnouncementHistoryVisible, setShowMembers, setShowSearchPanel, setMsgSearch, setSearchTypeFilters,
    setSearchSenderId, setSearchTimeRange, setSearchDatePreset, setSearchResults, setSearchTotal, setSearchPage,
    setSearchHasSearched, setContextMode, setShowMediaPanel, setMediaItems, setMediaPage, setMediaHasMore,
    setInput, setUnreadDivider, setConversations, setShowNewChat, setMessages,
  });

  const {
    sendFileMessage, sendSticker, handleSaveAsEmoji, handleTyping, sendImageFile,
    voiceRecorder, fetchLinkPreview,
  } = useSendMedia({
    activeConvId, currentUserId, currentUserNickname, appendMessageOnce, addEmojiMutation,
    setEmojiVisible,
  });

  const {
    handleSend, handleSelectImages, handleSelectFile, handleRemovePendingImage, handleRemovePendingFile, handleInputPaste,
    scrollToMessage, getReplyMessage, insertMention, applyMessageUpdate,
  } = useComposerActions({
    activeConvId, sending, setSending, input, setInput, pendingImages,
    setPendingImages, pendingFiles, setPendingFiles, saveDraft, setDraftsMap, replyTo,
    setReplyTo, selectedMentions, setSelectedMentions, fetchLinkPreview, appendMessageOnce, setFailedMessages,
    setUploadingItems, sendImageFile, sendFileMessage, setHighlightedMessageId, messages, virtuosoRef,
    firstItemIndex, setMessages, setHasMore, setOldestMsgId, setFirstItemIndex, setContextMode,
    mentionState: mention.mentionState, setMentionClosed: mention.setMentionClosed, activeGroupMembers, currentUserId, inputRef, setPinnedMessages,
    setFavoriteMessages, setConversations,
  });

  const {
    handleToggleFavorite, handleTogglePinMessage, handleEditRecalled, handleToggleSelectMessage, handleExitMultiSelect, handleForwardSingle,
    handleForwardSelected, handleForwardConfirm, handleFavoriteSelected, handleOpenForwardView, handleDeleteSingle, handleDeleteSelected,
    handleReaction, handlePickReactionEmoji, handleCreateVote, handleVoteMessage, handleEditMessage, handleRecall,
  } = useMessageActions({
    activeConvId, messages, selectedMessageIds, recalledDrafts, forwardingMessageIds, forwardingMode,
    inputRef, applyMessageUpdate, appendMessageOnce, setInput, setSelectedMentions,
    setMultiSelectMode, setSelectedMessageIds, setForwardingMode, setForwardingMessageIds, setForwardModalVisible, setForwardViewItems,
    setForwardViewTitle, setForwardViewVisible, setMessages, setMediaItems, setReactionTargetMsgId, setReactionPickerAnchor,
    setReactionPickerVisible, setShowVoteModal, setRecalledDrafts,
  });

  const { resetSearchFilters, applyDatePreset, senderOptions, executeSearch, jumpToSearchResult } = useConversationSearch({
    activeConv, activeConvId, currentUserId, currentUserNickname, messages, msgSearch,
    searchMembers, searchResults, searchSenderId, searchTimeRange, searchTypeFilters, showSearchPanel,
    scrollToMessage, setContextMode, setHasMore, setMessages, setMsgSearch, setOldestMsgId,
    setSearchDatePreset, setSearchHasSearched, setSearchLoading, setSearchMembers, setSearchPage, setSearchResults,
    setSearchSenderId, setSearchTimeRange, setSearchTotal, setSearchTypeFilters, setShowMembers, setShowSearchPanel,
  });

  const restoreLatestMessages = useCallback(async () => {
    if (!activeConvId) return;
    await fetchMessages(activeConvId);
  }, [activeConvId, fetchMessages]);

  const { fetchMediaItems } = useMediaLibrary({
    activeConvId, mediaType, showMediaPanel, setMediaHasMore, setMediaItems, setMediaLoading,
    setMediaPage,
  });

  const { refreshGroupAvatarMembers, handleAtBottomStateChange, handleStartReached, wsConnected } = useChatWebSocket({
    activeChannelId, activeConvId, contextMode, conversations, currentUserId, hasMore,
    loadingMsgs, oldestMsgId, pendingNewMsgCount, queryClient, restoreLatestMessages,
    fetchConversations, fetchMessages, appendMessageOnce, applyMessageUpdate,
    isAtBottomRef, virtuosoRef, wsDisconnectedSinceReadyRef, wsHasConnectedRef, setActiveConvId, setChannels,
    setConversations, setGroupAvatarMap, setLastSeenMap, setMediaItems, setMessages, setOnlineUserIds,
    setPendingNewMsgCount, setReadStates, setTypingUsers,
  });

  // 草稿自动保存（input 变化时持久化）
  useEffect(() => {
    if (activeConvId) saveDraft(activeConvId, input);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const { archivedConvs, archivedUnread, showArchiveToggle, leftListItems, totalUnread } = computeLeftListModel({
    conversations, channels, convSearch, showArchived,
  });

  /** 打开全局搜索结果：拉取上下文并跳转（原全局搜索列表 onClick 内联逻辑原样搬出） */
  const onOpenSearchResult = async (item: ChatMessageSearchItem) => {
    const context: ChatMessageContext | null = await api(chatContract.messageContext, {
      params: { id: item.message.conversationId, messageId: item.message.id },
      query: { before: 15, after: 15 },
    }, { silent: true }).catch(() => null);
    if (!context) {
      Toast.error('定位消息失败');
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
    setMessages(context.list);
    setHasMore(context.hasBefore);
    setOldestMsgId(context.list[0]?.id ?? null);
    setContextMode({ anchorMessageId: context.anchorMessageId, keyword: globalSearchKeyword.trim() });
    setTimeout(() => scrollToMessage(context.anchorMessageId), 80);
  };

  // 频道列表本地过滤：按名称包含匹配，不调接口
  const channelAvatarNode = useCallback((ch: Channel) => (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <UserAvatar name={ch.name} avatar={ch.avatar} size={38} />
      <BadgeCheck
        size={15}
        style={{ position: 'absolute', right: -2, bottom: -2, color: '#fff', fill: 'var(--semi-color-primary)' }}
        aria-label="官方频道"
      />
    </span>
  ), []);

  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [onUnreadChange, totalUnread]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => !currentUserId || !(m.extra?.hiddenFor ?? []).includes(currentUserId)),
    [messages, currentUserId],
  );
  const displayMessages = visibleMessages;

  /** 图集仅在点击图片时需要，点击时惰性收集，避免每次渲染都做 O(n) 过滤 */
  const handleOpenImageMessage = useCallback((imageMsg: ChatMessage) => {
    void openImagePreview(imageMsg, messages.filter((m) => m.type === 'image' && !m.isRecalled));
  }, [messages, openImagePreview]);

  /** 读回执按消息预计算，保持传给 MessageBubble 的对象身份稳定以配合其 memo */
  const readReceiptMap = useMemo(() => {
    const map = new Map<number, MessageReadReceipt | undefined>();
    for (const m of displayMessages) map.set(m.id, computeReadReceipt(m));
    return map;
  }, [displayMessages, computeReadReceipt]);

  useGroupAvatars({ conversations, groupAvatarMap, setGroupAvatarMap, refreshGroupAvatarMembers });

  const rootStyle = getRootStyle(isQuick);

  /** 传给每条气泡的回调：均来自 hooks 的稳定引用，MessageBubble 的 memo 才能生效 */
  const bubbleHandlers: MessageBubbleHandlers = {
    onReply: setReplyTo,
    onRecall: handleRecall,
    onOpenImage: handleOpenImageMessage,
    getReplyMessage,
    onScrollToMessage: scrollToMessage,
    onToggleFavorite: handleToggleFavorite,
    onTogglePin: handleTogglePinMessage,
    onEditRecalled: handleEditRecalled,
    onToggleSelect: handleToggleSelectMessage,
    onForwardSingle: handleForwardSingle,
    onOpenForwardView: handleOpenForwardView,
    onDeleteMessage: handleDeleteSingle,
    onReaction: handleReaction,
    onPickReactionEmoji: handlePickReactionEmoji,
    onEdit: handleEditMessage,
    onVote: handleVoteMessage,
    onSaveAsEmoji: handleSaveAsEmoji,
    onOpenFilePreview: openFilePreview,
    onCardAction: handleCardAction,
    onOpenWorkflow: handleOpenWorkflowFromCard,
  };

  return (
    <div style={rootStyle}>
      <MasterDetailLayout
        defaultSize={280}
        minSize={220}
        maxSize={420}
        gap={0}
        divider
        persistKey={isQuick ? undefined : 'messages'}
        responsiveBreakpoint={isQuick ? 99999 : undefined}
        showDetail={!!activeConv || activeChannelId != null}
        onBack={isQuick ? undefined : () => setActiveConvId(null)}
        master={(
          <ChatLeftPane
            isQuick={isQuick}
            onOpenFullPage={onOpenFullPage}
            onClose={onClose}
            activeConvId={activeConvId}
            totalUnread={totalUnread}
            openDiscover={openDiscover}
            showNewChat={showNewChat}
            setShowNewChat={setShowNewChat}
            handleNewDirectChat={handleNewDirectChat}
            handleGroupCreated={handleGroupCreated}
            convSearch={convSearch}
            setConvSearch={setConvSearch}
            leftPaneMode={leftPaneMode}
            setLeftPaneMode={setLeftPaneMode}
            loadingConvs={loadingConvs}
            showArchiveToggle={showArchiveToggle}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            archivedConvs={archivedConvs}
            archivedUnread={archivedUnread}
            leftListItems={leftListItems}
            listRowProps={{
              activeChannelId, setActiveChannelId, setActiveConvId, setChannels, channelAvatarNode,
              groupAvatarMap, onlineUserIds, activeConvId, failedMessages, draftsMap, handleSelectConv,
              setLeftPaneContextMenu,
            }}
            favoriteMessages={favoriteMessages}
            conversations={conversations}
            setFavPreviewMsg={setFavPreviewMsg}
            setFavPreviewVisible={setFavPreviewVisible}
            globalSearch={{
              globalSearchKeyword, setGlobalSearchKeyword, setGlobalSearchResults, setGlobalSearchTotal, setGlobalSearchHasSearched,
              setGlobalSearchLoading, globalSearchLoading, globalSearchHasSearched, globalSearchTotal, globalSearchResults, globalSearchPage,
              setGlobalSearchPage, globalSearchConvNames, setGlobalSearchConvNames, onOpenSearchResult,
            }}
            leftPaneContextMenu={leftPaneContextMenu}
            setLeftPaneContextMenu={setLeftPaneContextMenu}
            contextMenuProps={{
              setConversations, activeConvId, setActiveConvId, setMessages, setPendingNewMsgCount, openFavoriteMessage, setFavPreviewVisible,
              handleToggleFavorite, handleTogglePinMessage,
              canPinMessage: (msg) => {
                const conv = conversations.find((c) => c.id === msg.conversationId);
                return conv?.type !== 'group' || conv.myRole === 'owner' || conv.myRole === 'admin';
              },
              handleUnsubscribeChannel,
            }}
          />
        )}
        detail={activeChannelId != null && activeChannel ? (
          <ChannelMessageView
            channel={activeChannel}
            currentUserId={currentUserId}
            onBack={() => setActiveChannelId(null)}
            onUnsubscribe={() => { if (activeChannel) handleUnsubscribeChannel(activeChannel); }}
            onCardAction={handleCardAction}
            onOpenWorkflow={handleOpenWorkflowFromCard}
          />
        ) : activeConv ? (
          <>
          <ChatDetailHeader
            activeConv={activeConv}
            activeConvId={activeConvId}
            isQuick={isQuick}
            onOpenFullPage={onOpenFullPage}
            onClose={onClose}
            setActiveConvId={setActiveConvId}
            style={isQuick ? undefined : { padding: '8px 20px' }}
            announcementHistoryVisible={announcementHistoryVisible}
            setAnnouncementHistoryVisible={setAnnouncementHistoryVisible}
            handleStartCall={handleStartCall}
            notifyPrefs={notifyPrefs}
            showSearchPanel={showSearchPanel}
            setShowSearchPanel={setShowSearchPanel}
            showMediaPanel={showMediaPanel}
            setShowMediaPanel={setShowMediaPanel}
            showMembers={showMembers}
            setShowMembers={setShowMembers}
            canExport={hasPermission('chat:message:export')}
            exportingChat={exportingChat}
            handleExportChat={handleExportChat}
            pendingJoinRequestCount={pendingJoinRequestCount}
            onlineUserIds={onlineUserIds}
            lastSeenMap={lastSeenMap}
            groupAvatarMap={groupAvatarMap}
          />
          <MasterDetailLayout.Body scroll="hidden" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <ChatMessageList
              isQuick={isQuick}
              activeConvId={activeConvId}
              currentUserId={currentUserId}
              messages={messages}
              displayMessages={displayMessages}
              loadingMsgs={loadingMsgs}
              hasMore={hasMore}
              wsConnected={wsConnected}
              pinnedMessages={pinnedMessages}
              uploadingItems={uploadingItems}
              virtuosoRef={virtuosoRef}
              firstItemIndex={firstItemIndex}
              handleStartReached={handleStartReached}
              handleAtBottomStateChange={handleAtBottomStateChange}
              scrollToMessage={scrollToMessage}
              handleTogglePinMessage={handleTogglePinMessage}
              unreadDivider={unreadDivider}
              bubbleHandlers={bubbleHandlers}
              recalledDrafts={recalledDrafts}
              multiSelectMode={multiSelectMode}
              selectedMessageIds={selectedMessageIds}
              highlightedMessageId={highlightedMessageId}
              readReceiptMap={readReceiptMap}
              canPinInActiveConv={canPinInActiveConv}
              failedMessages={failedMessages}
              setFailedMessages={setFailedMessages}
              setInput={setInput}
              inputRef={inputRef}
              pendingNewMsgCount={pendingNewMsgCount}
              setPendingNewMsgCount={setPendingNewMsgCount}
              setConversations={setConversations}
            />

            {/* Group members sidebar */}
            {!isQuick && activeConv.type === 'group' && showMembers && !showSearchPanel && !showMediaPanel && (
              <GroupMembersPanel
                conversationId={activeConv.id}
                currentUserId={currentUserId}
                conv={activeConv}
                onlineUserIds={onlineUserIds}
                onConvUpdate={(patch) => {
                  setConversations((prev) =>
                    prev.map((c) => c.id === activeConv.id ? { ...c, ...patch } : c),
                  );
                }}
              />
            )}


            {/* ⑤ 媒体库面板 */}
            {!isQuick && showMediaPanel && !showSearchPanel && !showMembers && (
              <MediaPanel
                setShowMediaPanel={setShowMediaPanel} mediaType={mediaType} setMediaType={setMediaType}
                mediaLoading={mediaLoading} mediaItems={mediaItems} openImagePreview={openImagePreview}
                handleMediaFilePreview={openFilePreview} activeConvId={activeConvId} fetchMediaItems={fetchMediaItems}
                mediaPage={mediaPage} mediaHasMore={mediaHasMore}
              />
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

          <FilePreviewModal
            fileUrl={filePreview?.url ?? ''}
            fileName={filePreview?.name}
            mimeType={filePreview?.mimeType}
            visible={!!filePreview}
            onClose={closeFilePreview}
          />

          <AnnouncementHistoryModal
            announcementHistoryVisible={announcementHistoryVisible} setAnnouncementHistoryVisible={setAnnouncementHistoryVisible} announcementHistory={announcementHistory}
            isOwnerOfActiveGroup={isOwnerOfActiveGroup} handleDeleteAnnouncementHistory={handleDeleteAnnouncementHistory}
          />

          <ChatComposer
            isQuick={isQuick}
            activeConvId={activeConvId}
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            sending={sending}
            muteState={muteState}
            replyTo={replyTo}
            setReplyTo={setReplyTo}
            typingUsers={typingUsers}
            pendingImages={pendingImages}
            pendingFiles={pendingFiles}
            handleRemovePendingImage={handleRemovePendingImage}
            handleRemovePendingFile={handleRemovePendingFile}
            setPreviewSrcList={setPreviewSrcList}
            setPreviewCurrentIndex={setPreviewCurrentIndex}
            setPreviewVisible={setPreviewVisible}
            emojiVisible={emojiVisible}
            setEmojiVisible={setEmojiVisible}
            emojiContainerRef={emojiContainerRef}
            emojiPickerRef={emojiPickerRef}
            sendSticker={sendSticker}
            handleSelectImages={handleSelectImages}
            handleSelectFile={handleSelectFile}
            setShowVoteModal={setShowVoteModal}
            saveDraft={saveDraft}
            voiceRecorder={voiceRecorder}
            mention={mention}
            insertMention={insertMention}
            handleSend={handleSend}
            handleInputPaste={handleInputPaste}
            handleTyping={handleTyping}
            multiSelectMode={multiSelectMode}
            selectedMessageIds={selectedMessageIds}
            handleForwardSelected={handleForwardSelected}
            handleFavoriteSelected={handleFavoriteSelected}
            handleDeleteSelected={handleDeleteSelected}
            handleExitMultiSelect={handleExitMultiSelect}
          />
          </MasterDetailLayout.Body>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty
              description={<span>选择一个会话开始聊天，<br />或点击右上角「+」新建</span>}
              imageStyle={{ width: 100 }}
            />
          </div>
        )}
      />
      {inviteToken && (
        <JoinInviteModal
          token={inviteToken}
          onClose={() => setInviteToken(null)}
          onJoined={(convId) => {
            void fetchConversations().then(() => {
              setActiveConvId(convId);
              setActiveChannelId(null);
              void fetchMessages(convId);
            });
          }}
        />
      )}
      <DiscoverChannelsModal
        discoverVisible={discoverVisible} setDiscoverVisible={setDiscoverVisible} discoverKeyword={discoverKeyword}
        setDiscoverKeyword={setDiscoverKeyword} discoverList={discoverList} handleSubscribeChannel={handleSubscribeChannel}
      />

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
      <WorkflowApprovalDetailSheet
        instanceId={cardSheet?.instanceId ?? null}
        taskId={cardSheet?.taskId ?? null}
        initialAction={cardSheet?.action ?? null}
        visible={!!cardSheet}
        onClose={() => setCardSheet(null)}
        onActionDone={() => {
          if (cardSheet?.messageId) {
            const statusText = cardSheet.action === 'reject' ? '已驳回' : '已处理';
            setMessages(markCardDoneLocal(cardSheet.messageId, statusText));
          } else if (activeConvId) {
            void fetchMessages(activeConvId);
          }
        }}
      />
      {/* Reaction emoji picker — fixed overlay */}
      {reactionPickerVisible && reactionPickerAnchor && (
        <Suspense fallback={null}>
          <ReactionPickerOverlay
            reactionPickerRef={reactionPickerRef} reactionPickerAnchor={reactionPickerAnchor} reactionTargetMsgId={reactionTargetMsgId}
            handleReaction={handleReaction} setReactionPickerVisible={setReactionPickerVisible}
          />
        </Suspense>
      )}
      <ForwardedMessagesModal
        visible={forwardViewVisible}
        items={forwardViewItems}
        title={forwardViewTitle}
        onCancel={() => setForwardViewVisible(false)}
      />
      {favPreviewMsg && (
        <FavoriteMessageModal
          favPreviewMsg={favPreviewMsg} conversations={conversations} favPreviewVisible={favPreviewVisible}
          setFavPreviewVisible={setFavPreviewVisible} handleToggleFavorite={handleToggleFavorite} openFavoriteMessage={openFavoriteMessage}
          handleOpenForwardView={handleOpenForwardView}
        />
      )}

      {/* 聊天记录搜索弹窗 */}
      <MessageSearchModal
        showSearchPanel={showSearchPanel} setShowSearchPanel={setShowSearchPanel} resetSearchFilters={resetSearchFilters}
        searchHasSearched={searchHasSearched} searchTotal={searchTotal} msgSearch={msgSearch}
        setMsgSearch={setMsgSearch} executeSearch={executeSearch} searchTypeFilters={searchTypeFilters}
        setSearchTypeFilters={setSearchTypeFilters} searchSenderId={searchSenderId} setSearchSenderId={setSearchSenderId}
        senderOptions={senderOptions} searchDatePreset={searchDatePreset} applyDatePreset={applyDatePreset}
        setSearchDatePreset={setSearchDatePreset}
        searchTimeRange={searchTimeRange} setSearchTimeRange={setSearchTimeRange} searchLoading={searchLoading}
        searchResults={searchResults} searchPage={searchPage} jumpToSearchResult={jumpToSearchResult}
      />
    </div>
  );
}
