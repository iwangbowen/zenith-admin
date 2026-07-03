/**
 * 频道（站内公众号 / 系统号）消息视图
 *
 * - 系统号（system）：只读，纯单向接收系统通知/工作流卡片。
 * - 运营号（business）：双向客服。底部输入框 + 公众号底部菜单（click 触发关键词 / view 跳转链接），
 *   用户消息（direction='in'）以「自己」气泡靠右展示，频道回复（out）靠左展示。
 *
 * 复用 MessageBubble 渲染气泡，订阅 WS channel:message 实时追加（按 id 去重）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Rating, Spin, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { ArrowLeft, BadgeCheck, ChevronUp, ExternalLink, Send, Star } from 'lucide-react';
import type { Channel, ChannelMenu, ChannelMessage, ChatMessage, ChatCardAction, WsMessage } from '@zenith/shared';
import { request } from '@/utils/request';
import { useWebSocket } from '@/hooks/useWebSocket';
import { UserAvatar } from '@/components/UserAvatar';
import AppModal from '@/components/AppModal';
import { MessageBubble } from './MessageBubble';
import { useChannelMenus, useChannelMessages } from '@/hooks/queries/chat';

const { Text } = Typography;

interface Props {
  channel: Channel;
  currentUserId: number | null;
  onBack: () => void;
  onUnsubscribe?: () => void;
  onCardAction: (msg: ChatMessage, action: ChatCardAction) => void;
  onOpenWorkflow: (instanceId: number, taskId: number | null) => void;
}

function toChatMessage(m: ChannelMessage, channel: Pick<Channel, 'name' | 'avatar'>): ChatMessage {
  const isIn = m.direction === 'in';
  return {
    id: m.id,
    conversationId: 0,
    senderId: isIn ? m.senderUserId : null,
    senderName: isIn ? (m.senderUserName ?? '我') : channel.name,
    senderAvatar: isIn ? null : channel.avatar,
    // 图文（news）复用卡片渲染路径：映射为 'card'，由 CardMessage 识别 cover 字段增强展示
    type: m.type === 'news' ? 'card' : m.type,
    content: m.content,
    replyToId: null,
    replyToMessage: null,
    isRecalled: false,
    isEdited: false,
    extra: m.extra,
    reactions: [],
    createdAt: m.createdAt,
    updatedAt: m.createdAt,
  };
}

const noop = () => { /* 频道气泡：禁用交互 */ };

export function ChannelMessageView({ channel, currentUserId, onBack, onUnsubscribe, onCardAction, onOpenWorkflow }: Readonly<Props>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [retractedIds, setRetractedIds] = useState<Set<number>>(new Set());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [rateVisible, setRateVisible] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [rateSubmitting, setRateSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isBusiness = channel.type === 'business';
  const channelMessagesQuery = useChannelMessages({ channelId: channel.id, page: 1, pageSize: 50 });
  const channelMenusQuery = useChannelMenus(channel.id, isBusiness);
  const menus = channelMenusQuery.data ?? [];
  const loading = channelMessagesQuery.isFetching && messages.length === 0;
  const channelSender = useMemo(() => ({ name: channel.name, avatar: channel.avatar }), [channel.name, channel.avatar]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const appendMessage = useCallback((m: ChannelMessage) => {
    if (m.channelId !== channel.id) return;
    if (m.isRetracted) {
      setRetractedIds((prev) => {
        if (prev.has(m.id)) return prev;
        const next = new Set(prev);
        next.add(m.id);
        return next;
      });
    }
    setMessages((prev) => {
      const mapped = toChatMessage(m, channelSender);
      const idx = prev.findIndex((x) => x.id === m.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = mapped;
        return next;
      }
      return [...prev, mapped];
    });
  }, [channel.id, channelSender]);

  useEffect(() => {
    setMessages([]);
    setRetractedIds(new Set());
    setInput('');
    // 仅在切换频道（channel.id 变化）时重载消息；频道元信息（lastMessage/未读数）更新会生成新的 channel 对象，
    // 不应据此清空并重拉消息，否则审批置灰卡片等推送会导致整页闪烁。
  }, [channel.id]);

  useEffect(() => {
    if (!channelMessagesQuery.data) return;
    const ordered = [...channelMessagesQuery.data.list].reverse();
    setMessages(ordered.map((m) => toChatMessage(m, channelSender)));
    setRetractedIds(new Set(ordered.filter((m) => m.isRetracted).map((m) => m.id)));
    scrollToBottom();
    void request.post(`/api/channels/${channel.id}/read`, {}, { silent: true });
  }, [channel.id, channelMessagesQuery.data, channelSender, scrollToBottom]);

  const handleWs = useCallback((wsMsg: WsMessage) => {
    if (wsMsg.type === 'channel:message-retract') {
      if (wsMsg.payload.channelId !== channel.id) return;
      const { messageId } = wsMsg.payload;
      setRetractedIds((prev) => {
        if (prev.has(messageId)) return prev;
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });
      return;
    }
    if (wsMsg.type !== 'channel:message') return;
    const m = wsMsg.payload;
    if (m.channelId !== channel.id) return;
    // 仅展示与本人相关的消息：广播 / 定向到本人的 out / 本人发出的 in
    if (m.direction === 'in' && m.senderUserId !== currentUserId) return;
    appendMessage(m);
    scrollToBottom();
    void request.post(`/api/channels/${channel.id}/read`, {}, { silent: true });
  }, [channel.id, currentUserId, appendMessage, scrollToBottom]);

  useWebSocket(handleWs);

  const sendContent = useCallback(async (content: string) => {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await request.post<{ message: ChannelMessage; autoReply: ChannelMessage | null }>(
        `/api/channels/${channel.id}/send`, { content: text }, { silent: true },
      );
      if (res.code === 0 && res.data) {
        setInput('');
        appendMessage(res.data.message);
        if (res.data.autoReply) appendMessage(res.data.autoReply);
        scrollToBottom();
      } else {
        Toast.error(res.message || '发送失败');
      }
    } finally {
      setSending(false);
    }
  }, [channel.id, sending, appendMessage, scrollToBottom]);

  const handleSubmitRating = useCallback(async () => {
    if (rateSubmitting) return;
    setRateSubmitting(true);
    try {
      const res = await request.post(
        `/api/channels/${channel.id}/rate`,
        { rating, comment: comment.trim() || null },
        { silent: true },
      );
      if (res.code === 0) {
        Toast.success('感谢您的评价');
        setRateVisible(false);
        setRating(5);
        setComment('');
      } else {
        Toast.error(res.message || '评价失败');
      }
    } finally {
      setRateSubmitting(false);
    }
  }, [channel.id, rating, comment, rateSubmitting]);

  const handleMenuClick = useCallback((menu: ChannelMenu) => {
    if (menu.type === 'view') {
      if (menu.value) window.open(menu.value, '_blank', 'noopener,noreferrer');
      return;
    }
    void sendContent(menu.value || menu.name);
  }, [sendContent]);

  const renderMenuBar = () => {
    if (!isBusiness || menus.length === 0) return null;
    return (
      <div style={{ display: 'flex', borderTop: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)' }}>
        {menus.map((top) => {
          const children = top.children ?? [];
          const cell = (
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 4px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, userSelect: 'none' }}>
              {children.length > 0 && <ChevronUp size={13} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top.name}</span>
            </div>
          );
          if (children.length > 0) {
            return (
              <Dropdown
                key={top.id}
                trigger="click"
                position="top"
                render={(
                  <Dropdown.Menu>
                    {children.map((sub) => (
                      <Dropdown.Item key={sub.id} onClick={() => handleMenuClick(sub)}>
                        {sub.type === 'view' && <ExternalLink size={13} style={{ marginRight: 6 }} />}
                        {sub.name}
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                )}
                style={{ flex: 1 }}
              >
                {cell}
              </Dropdown>
            );
          }
          return (
            <div key={top.id} style={{ flex: 1, display: 'flex' }} onClick={() => handleMenuClick(top)}>
              {cell}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--semi-color-border)' }}>
        <Button icon={<ArrowLeft size={16} />} theme="borderless" type="tertiary" onClick={onBack} />
        <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          <UserAvatar name={channel.name} avatar={channel.avatar} size={32} />
          <BadgeCheck
            size={13}
            style={{ position: 'absolute', right: -2, bottom: -2, color: '#fff', fill: 'var(--semi-color-primary)' }}
            aria-label="官方频道"
          />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channel.name}</Text>
          {channel.description && (
            <Text type="tertiary" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channel.description}</Text>
          )}
        </div>
        {channel.type === 'business' && (
          <Button
            size="small"
            type="tertiary"
            theme="borderless"
            icon={<Star size={14} />}
            onClick={() => setRateVisible(true)}
          >
            评价客服
          </Button>
        )}
        {channel.type === 'business' && onUnsubscribe && (
          <Button size="small" type="tertiary" theme="borderless" onClick={onUnsubscribe}>退订</Button>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 0', minHeight: 0 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : messages.length === 0 ? (
          <Empty description={isBusiness ? '暂无消息，发送一条试试' : '暂无消息'} style={{ padding: 40 }} />
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{ padding: '0 20px 16px' }}>
              {retractedIds.has(msg.id) ? (
                <div style={{ textAlign: 'center', color: 'var(--semi-color-text-2)', fontSize: 12 }}>
                  该消息已被撤回
                </div>
              ) : (
              <MessageBubble
                msg={msg}
                isSelf={msg.senderId != null && msg.senderId === currentUserId}
                shouldShowTime
                currentUserId={currentUserId}
                onReply={noop}
                onRecall={noop}
                onOpenImage={noop}
                getReplyMessage={() => undefined}
                onScrollToMessage={noop}
                onToggleFavorite={noop}
                onTogglePin={noop}
                onEditRecalled={noop}
                onCardAction={onCardAction}
                onOpenWorkflow={onOpenWorkflow}
                verifiedSender
              />
              )}
            </div>
          ))
        )}
      </div>

      {isBusiness ? (
        <div style={{ flexShrink: 0 }}>
          {renderMenuBar()}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--semi-color-border)' }}>
            <TextArea
              value={input}
              onChange={setInput}
              autosize={{ minRows: 1, maxRows: 4 }}
              placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendContent(input);
                }
              }}
            />
            <Button
              type="primary"
              theme="solid"
              icon={<Send size={14} />}
              loading={sending}
              disabled={!input.trim()}
              onClick={() => void sendContent(input)}
            >
              发送
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ flexShrink: 0, textAlign: 'center', padding: '10px 16px', borderTop: '1px solid var(--semi-color-border)', color: 'var(--semi-color-text-2)', fontSize: 12 }}>
          该频道仅用于接收系统通知，不支持回复
        </div>
      )}

      <AppModal
        title="评价客服服务"
        visible={rateVisible}
        closeOnEsc
        onCancel={() => setRateVisible(false)}
        onOk={() => void handleSubmitRating()}
        okText="提交评价"
        cancelText="取消"
        okButtonProps={{ loading: rateSubmitting, disabled: rating < 1 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Text>服务评分</Text>
            <Rating value={rating} onChange={setRating} />
          </div>
          <TextArea
            value={comment}
            onChange={setComment}
            placeholder="说说您的服务体验（选填）"
            maxCount={500}
            autosize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
      </AppModal>
    </div>
  );
}

export default ChannelMessageView;
