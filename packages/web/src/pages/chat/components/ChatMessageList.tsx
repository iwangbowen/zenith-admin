import { useMemo } from 'react';
import type { ComponentProps, RefObject } from 'react';
import { Button, Divider, Empty, Spin } from '@douyinfe/semi-ui';
import { Virtuoso, type VirtuosoHandle, type Components } from 'react-virtuoso';
import type { ChatConversation, ChatMessage } from '@zenith/shared/chat';
import { chatContract } from '@zenith/shared/chat';
import { api } from '@/lib/contract-query';
import { shouldDisplayMessageTime } from '../utils';
import { markConversationReadById } from '../utils-state';
import type { FailedMessage, MessageReadReceipt, Setter, UploadingItem } from '../types';
import { MessageBubble } from './MessageBubble';
import { UploadingFooter } from './UploadingFooter';
import { MessagesListHeader } from './MessagesListHeader';
import { FailedMessagesList } from './FailedMessagesList';
import { WsDisconnectedBanner } from './WsDisconnectedBanner';

/**
 * Virtuoso Header/Footer 依赖的数据经 context 传入，组件本身定义在模块级。
 * 内联在 components={{...}} 里的箭头函数每次渲染都是新组件类型，
 * 会导致 Header/Footer 被卸载重挂而非更新。
 */
interface MessagesVirtuosoContext {
  uploadingItems: UploadingItem[];
  activeConvId: number | null;
  isQuick: boolean;
  wsConnected: boolean;
  pinnedMessages: ChatMessage[];
  scrollToMessage: (messageId: number) => Promise<void>;
  handleTogglePinMessage: (msg: ChatMessage) => Promise<void>;
  hasMore: boolean;
  loadingMsgs: boolean;
}

function MessagesVirtuosoFooter({ context }: Readonly<{ context?: MessagesVirtuosoContext }>) {
  if (!context) return null;
  return (
    <UploadingFooter
      uploadingItems={context.uploadingItems} activeConvId={context.activeConvId} isQuick={context.isQuick}
    />
  );
}

function MessagesVirtuosoHeader({ context }: Readonly<{ context?: MessagesVirtuosoContext }>) {
  if (!context) return null;
  return (
    <MessagesListHeader
      isQuick={context.isQuick} wsConnected={context.wsConnected} pinnedMessages={context.pinnedMessages}
      scrollToMessage={context.scrollToMessage} handleTogglePinMessage={context.handleTogglePinMessage}
      hasMore={context.hasMore} loadingMsgs={context.loadingMsgs}
    />
  );
}

const MESSAGES_VIRTUOSO_COMPONENTS: Components<ChatMessage, MessagesVirtuosoContext> = {
  Footer: MessagesVirtuosoFooter,
  Header: MessagesVirtuosoHeader,
};

const computeMessageItemKey = (_idx: number, msg: ChatMessage) => msg.id;

type BubbleProps = ComponentProps<typeof MessageBubble>;

/** 透传给每条 MessageBubble 的稳定回调（身份稳定以配合其 memo） */
export type MessageBubbleHandlers = Pick<BubbleProps,
  | 'onReply' | 'onRecall' | 'onOpenImage' | 'getReplyMessage' | 'onScrollToMessage' | 'onToggleFavorite' | 'onTogglePin'
  | 'onEditRecalled' | 'onToggleSelect' | 'onForwardSingle' | 'onOpenForwardView' | 'onDeleteMessage' | 'onReaction'
  | 'onPickReactionEmoji' | 'onEdit' | 'onVote' | 'onSaveAsEmoji' | 'onOpenFilePreview' | 'onCardAction' | 'onOpenWorkflow'
>;

interface ChatMessageListProps {
  isQuick: boolean;
  activeConvId: number | null;
  currentUserId: number | null;
  /** 全部消息（判定首载）与过滤掉「对我隐藏」后的展示消息 */
  messages: ChatMessage[];
  displayMessages: ChatMessage[];
  loadingMsgs: boolean;
  hasMore: boolean;
  wsConnected: boolean;
  pinnedMessages: ChatMessage[];
  uploadingItems: UploadingItem[];
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  firstItemIndex: number;
  handleStartReached: () => void;
  handleAtBottomStateChange: (atBottom: boolean) => void;
  scrollToMessage: (messageId: number) => Promise<void>;
  handleTogglePinMessage: (msg: ChatMessage) => Promise<void>;
  unreadDivider: { convId: number; messageId: number } | null;
  bubbleHandlers: MessageBubbleHandlers;
  recalledDrafts: Record<number, { content: string; mentions?: Array<{ userId: number; nickname: string }> }>;
  multiSelectMode: boolean;
  selectedMessageIds: number[];
  highlightedMessageId: number | null;
  readReceiptMap: Map<number, MessageReadReceipt | undefined>;
  canPinInActiveConv: boolean;
  // ── 发送失败重试 ──
  failedMessages: FailedMessage[];
  setFailedMessages: Setter<FailedMessage[]>;
  setInput: Setter<string>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  // ── 新消息提示 ──
  pendingNewMsgCount: number;
  setPendingNewMsgCount: Setter<number>;
  setConversations: Setter<ChatConversation[]>;
}

/** 消息区：首载 Spin / 空态 / Virtuoso 虚拟列表（含未读分隔线与置顶头、上传底栏）、发送失败重试列表与「N 条新消息」按钮 */
export function ChatMessageList({
  isQuick, activeConvId, currentUserId, messages, displayMessages, loadingMsgs, hasMore, wsConnected, pinnedMessages,
  uploadingItems, virtuosoRef, firstItemIndex, handleStartReached, handleAtBottomStateChange, scrollToMessage,
  handleTogglePinMessage, unreadDivider, bubbleHandlers, recalledDrafts, multiSelectMode, selectedMessageIds,
  highlightedMessageId, readReceiptMap, canPinInActiveConv,
  failedMessages, setFailedMessages, setInput, inputRef,
  pendingNewMsgCount, setPendingNewMsgCount, setConversations,
}: Readonly<ChatMessageListProps>) {
  const virtuosoContext = useMemo<MessagesVirtuosoContext>(() => ({
    uploadingItems, activeConvId, isQuick, wsConnected, pinnedMessages,
    scrollToMessage, handleTogglePinMessage, hasMore, loadingMsgs,
  }), [uploadingItems, activeConvId, isQuick, wsConnected, pinnedMessages, scrollToMessage, handleTogglePinMessage, hasMore, loadingMsgs]);

  const hasFailedInCurrentConv = failedMessages.some((m) => m.convId === activeConvId);
  const isEmptyMessagesView = displayMessages.length === 0 && !hasFailedInCurrentConv;
  const isInitialLoadingMessages = loadingMsgs && messages.length === 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', overflow: 'hidden' }}>
      {isInitialLoadingMessages && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="middle" />
        </div>
      )}
      {!isInitialLoadingMessages && isEmptyMessagesView && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
          {!wsConnected && <WsDisconnectedBanner />}
          <Empty description="发送第一条消息吧" imageStyle={{ width: 80 }} />
        </div>
      )}
      {!isInitialLoadingMessages && !isEmptyMessagesView && (
        <Virtuoso
          ref={virtuosoRef}
          style={{ flex: 1 }}
          data={displayMessages}
          context={virtuosoContext}
          firstItemIndex={firstItemIndex}
          initialTopMostItemIndex={Math.max(displayMessages.length - 1, 0)}
          followOutput={uploadingItems.some((u) => u.convId === activeConvId) ? 'smooth' : false}
          startReached={handleStartReached}
          atBottomStateChange={handleAtBottomStateChange}
          atBottomThreshold={120}
          increaseViewportBy={{ top: 600, bottom: 200 }}
          computeItemKey={computeMessageItemKey}
          components={MESSAGES_VIRTUOSO_COMPONENTS}
          itemContent={(virtualIndex, msg) => { // NOSONAR
            const realIndex = virtualIndex - firstItemIndex;
            const showUnreadDivider = unreadDivider?.convId === activeConvId && unreadDivider.messageId === msg.id;
            return (
              <div style={{ padding: isQuick ? '0 12px 16px' : '0 20px 16px' }}>
                {showUnreadDivider && (
                  <Divider align="center" className="chat-unread-divider" style={{ margin: '4px 0 12px' }}>
                    以下为新消息
                  </Divider>
                )}
                <MessageBubble
                  msg={msg}
                  isSelf={msg.senderId === currentUserId}
                  shouldShowTime={shouldDisplayMessageTime(msg, displayMessages[realIndex + 1])}
                  recalledDraft={recalledDrafts[msg.id]}
                  multiSelectMode={multiSelectMode}
                  isSelected={selectedMessageIds.includes(msg.id)}
                  currentUserId={currentUserId}
                  isHighlighted={highlightedMessageId === msg.id}
                  readReceipt={readReceiptMap.get(msg.id)}
                  canPin={canPinInActiveConv}
                  {...bubbleHandlers}
                />
              </div>
            );
          }}
        />
      )}
      {/* ⑥ 发送失败重试 */}
      {hasFailedInCurrentConv && (
        <FailedMessagesList
          isQuick={isQuick} failedMessages={failedMessages} activeConvId={activeConvId}
          setFailedMessages={setFailedMessages} setInput={setInput} inputRef={inputRef}
        />
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
                void api(chatContract.markRead, { params: { id: activeConvId } }, { silent: true }).catch(() => undefined);
                setConversations(markConversationReadById(activeConvId));
              }
            }}
          >
            有 {pendingNewMsgCount} 条新消息，点击查看
          </Button>
        </div>
      )}
    </div>
  );
}
