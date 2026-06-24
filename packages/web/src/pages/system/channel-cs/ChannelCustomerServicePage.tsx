/**
 * 客服工作台（运营号双向客服）
 *
 * 左侧按用户聚合的会话列表，右侧双向消息流 + 回复框。
 * 用户消息（in）靠左，频道回复（out：客服/自动回复）靠右。
 * 采用轮询刷新：会话列表 10s、活动会话消息 6s。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Empty, Select, Spin, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { RotateCcw, Send } from 'lucide-react';
import type { ChannelConversation, ChannelMessage, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { UserAvatar } from '@/components/UserAvatar';

const { Text } = Typography;

interface CsChannel {
  id: number;
  name: string;
  avatar: string | null;
}

export default function ChannelCustomerServicePage() {
  const [channels, setChannels] = useState<CsChannel[]>([]);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ChannelConversation[]>([]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  const activeConv = useMemo(
    () => conversations.find((c) => c.userId === activeUserId) ?? null,
    [conversations, activeUserId],
  );

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // 加载客服可服务的运营号
  useEffect(() => {
    void (async () => {
      const res = await request.get<CsChannel[]>('/api/channels/cs/channels', { silent: true });
      if (res.code === 0 && res.data) {
        setChannels(res.data);
        if (res.data.length > 0) setChannelId((prev) => prev ?? res.data[0].id);
      }
    })();
  }, []);

  const fetchConversations = useCallback(async (cid: number) => {
    const res = await request.get<ChannelConversation[]>(`/api/channels/cs/${cid}/conversations`, { silent: true });
    if (res.code === 0 && res.data) setConversations(res.data);
  }, []);

  const fetchMessages = useCallback(async (cid: number, uid: number, showSpin = false) => {
    if (showSpin) setLoadingMsg(true);
    try {
      const res = await request.get<PaginatedResponse<ChannelMessage>>(
        `/api/channels/cs/${cid}/conversations/${uid}/messages?page=1&pageSize=50`,
        { silent: true },
      );
      if (res.code === 0 && res.data) {
        const ordered = [...res.data.list].reverse();
        setMessages(ordered);
        if (ordered.length !== lastCountRef.current) {
          lastCountRef.current = ordered.length;
          scrollToBottom();
        }
      }
    } finally {
      if (showSpin) setLoadingMsg(false);
    }
  }, [scrollToBottom]);

  // 切换频道：重置会话 + 加载
  useEffect(() => {
    if (channelId == null) return;
    setConversations([]);
    setActiveUserId(null);
    setMessages([]);
    void fetchConversations(channelId);
  }, [channelId, fetchConversations]);

  // 轮询会话列表
  useEffect(() => {
    if (channelId == null) return;
    const timer = setInterval(() => { void fetchConversations(channelId); }, 10000);
    return () => clearInterval(timer);
  }, [channelId, fetchConversations]);

  // 切换会话：加载消息
  useEffect(() => {
    if (channelId == null || activeUserId == null) return;
    lastCountRef.current = 0;
    void fetchMessages(channelId, activeUserId, true);
  }, [channelId, activeUserId, fetchMessages]);

  // 轮询活动会话消息
  useEffect(() => {
    if (channelId == null || activeUserId == null) return;
    const timer = setInterval(() => { void fetchMessages(channelId, activeUserId); }, 6000);
    return () => clearInterval(timer);
  }, [channelId, activeUserId, fetchMessages]);

  const handleReply = useCallback(async () => {
    const content = reply.trim();
    if (!content || sending || channelId == null || activeUserId == null) return;
    setSending(true);
    try {
      const res = await request.post<ChannelMessage>(
        `/api/channels/cs/${channelId}/conversations/${activeUserId}/reply`,
        { content },
        { silent: true },
      );
      if (res.code === 0 && res.data) {
        setReply('');
        setMessages((prev) => [...prev, res.data as ChannelMessage]);
        lastCountRef.current += 1;
        scrollToBottom();
        void fetchConversations(channelId);
      } else {
        Toast.error(res.message || '回复失败');
      }
    } finally {
      setSending(false);
    }
  }, [reply, sending, channelId, activeUserId, scrollToBottom, fetchConversations]);

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Text strong>运营号</Text>
        <Select
          value={channelId ?? undefined}
          onChange={(v) => setChannelId(v as number)}
          placeholder="选择运营号"
          style={{ width: 220 }}
          optionList={channels.map((c) => ({ label: c.name, value: c.id }))}
        />
        <Button
          icon={<RotateCcw size={14} />}
          onClick={() => { if (channelId != null) { void fetchConversations(channelId); if (activeUserId != null) void fetchMessages(channelId, activeUserId, true); } }}
        >
          刷新
        </Button>
      </div>

      {channels.length === 0 ? (
        <Empty description="暂无可服务的运营号" style={{ padding: 60 }} />
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, border: '1px solid var(--semi-color-border)', borderRadius: 8, overflow: 'hidden' }}>
          {/* 会话列表 */}
          <div style={{ width: 300, borderRight: '1px solid var(--semi-color-border)', overflowY: 'auto', flexShrink: 0 }}>
            {conversations.length === 0 ? (
              <Empty description="暂无会话" style={{ padding: 40 }} />
            ) : conversations.map((c) => (
              <div
                key={c.userId}
                onClick={() => setActiveUserId(c.userId)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
                  background: activeUserId === c.userId ? 'var(--semi-color-primary-light-default)' : 'transparent',
                  borderBottom: '1px solid var(--semi-color-fill-0)',
                }}
              >
                <Badge count={c.unreadCount} overflowCount={99} type="danger">
                  <UserAvatar name={c.userName} avatar={c.userAvatar} size={36} />
                </Badge>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <Text strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.userName}</Text>
                    <Text type="tertiary" size="small" style={{ flexShrink: 0 }}>{c.lastMessageAt.slice(5, 16)}</Text>
                  </div>
                  <Text type="tertiary" size="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.lastDirection === 'out' ? '我方：' : ''}{c.lastMessage}
                  </Text>
                </div>
              </div>
            ))}
          </div>

          {/* 消息流 + 回复框 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {activeConv == null ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="选择左侧会话开始回复" />
              </div>
            ) : (
              <>
                <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid var(--semi-color-border)' }}>
                  <Text strong>{activeConv.userName}</Text>
                  <Text type="tertiary" size="small" style={{ marginLeft: 8 }}>共 {activeConv.messageCount} 条消息</Text>
                </div>

                <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 }}>
                  {loadingMsg ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  ) : messages.map((m) => {
                    const isOut = m.direction === 'out';
                    return (
                      <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isOut ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
                        <Text type="tertiary" size="small" style={{ marginBottom: 2 }}>
                          {isOut ? (m.senderUserName ? `${m.senderUserName}（客服）` : '自动回复') : (m.senderUserName ?? '用户')} · {formatDateTime(m.createdAt)}
                        </Text>
                        <div style={{
                          maxWidth: '70%', padding: '8px 12px', borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          background: isOut ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-0)',
                          color: isOut ? '#fff' : 'var(--semi-color-text-0)',
                        }}>
                          {m.content}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--semi-color-border)' }}>
                  <TextArea
                    value={reply}
                    onChange={setReply}
                    autosize={{ minRows: 1, maxRows: 4 }}
                    placeholder="输入回复，Enter 发送 / Shift+Enter 换行"
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleReply();
                      }
                    }}
                  />
                  <Button type="primary" theme="solid" icon={<Send size={14} />} loading={sending} disabled={!reply.trim()} onClick={() => void handleReply()}>
                    回复
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
