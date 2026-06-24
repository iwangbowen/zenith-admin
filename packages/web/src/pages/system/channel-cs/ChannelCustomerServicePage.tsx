/**
 * 客服工作台（运营号双向客服）
 *
 * 左侧按用户聚合的会话列表，右侧双向消息流 + 回复框。
 * 用户消息（in）靠左，频道回复（out：客服/自动回复）靠右。
 * 实时刷新：订阅 WS channel:cs-message 事件即时更新；轮询作为兜底（会话列表 30s、活动会话消息 15s）。
 * 回复框支持快捷回复（插入）与快捷回复 CRUD 管理。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Dropdown, Empty, Input, Select, Spin, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { BarChart3, CheckCheck, MessageSquareText, RotateCcw, Search, Send, Settings, Tag as TagIcon, UserCheck } from 'lucide-react';
import type { ChannelConversation, ChannelConversationStatus, ChannelCsAgent, ChannelMessage, ChannelQuickReply, PaginatedResponse, WsMessage } from '@zenith/shared';
import { CHANNEL_CONVERSATION_STATUS_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { useWebSocket } from '@/hooks/useWebSocket';
import { UserAvatar } from '@/components/UserAvatar';
import { ChannelQuickReplyDrawer } from './ChannelQuickReplyDrawer';
import { ConversationTagModal } from './ConversationTagModal';
import { ChannelCsPerformanceDrawer } from './ChannelCsPerformanceDrawer';

const { Text } = Typography;

type StatusFilter = 'all' | ChannelConversationStatus;
type AssigneeFilter = 'all' | 'mine' | 'unassigned';

const STATUS_TAG_COLOR: Record<ChannelConversationStatus, 'orange' | 'blue' | 'green'> = {
  open: 'orange',
  processing: 'blue',
  resolved: 'green',
};

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
  const [quickReplies, setQuickReplies] = useState<ChannelQuickReply[]>([]);
  const [manageVisible, setManageVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [agents, setAgents] = useState<ChannelCsAgent[]>([]);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [performanceVisible, setPerformanceVisible] = useState(false);
  const [opLoading, setOpLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);
  const channelIdRef = useRef<number | null>(null);
  const activeUserIdRef = useRef<number | null>(null);
  const statusFilterRef = useRef<StatusFilter>('all');
  const assigneeFilterRef = useRef<AssigneeFilter>('all');
  const keywordRef = useRef('');

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
    const params = new URLSearchParams();
    if (statusFilterRef.current !== 'all') params.set('status', statusFilterRef.current);
    if (assigneeFilterRef.current !== 'all') params.set('assignee', assigneeFilterRef.current);
    const kw = keywordRef.current.trim();
    if (kw) params.set('keyword', kw);
    const qs = params.toString();
    const res = await request.get<ChannelConversation[]>(
      `/api/channels/cs/${cid}/conversations${qs ? `?${qs}` : ''}`,
      { silent: true },
    );
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

  const fetchQuickReplies = useCallback(async (cid: number) => {
    const res = await request.get<ChannelQuickReply[]>(
      `/api/channels/cs/quick-replies?channelId=${cid}`,
      { silent: true },
    );
    if (res.code === 0 && res.data) setQuickReplies(res.data);
  }, []);

  // 保持当前频道 / 会话引用，供 WS 回调读取最新值
  useEffect(() => { channelIdRef.current = channelId; }, [channelId]);
  useEffect(() => { activeUserIdRef.current = activeUserId; }, [activeUserId]);

  // 保持筛选条件引用，供 WS / 轮询刷新时带上当前筛选
  useEffect(() => { statusFilterRef.current = statusFilter; }, [statusFilter]);
  useEffect(() => { assigneeFilterRef.current = assigneeFilter; }, [assigneeFilter]);
  useEffect(() => { keywordRef.current = keyword; }, [keyword]);

  // 筛选变化时重新加载会话列表
  useEffect(() => {
    if (channelId == null) return;
    void fetchConversations(channelId);
  }, [channelId, statusFilter, assigneeFilter, keyword, fetchConversations]);

  // 加载可指派客服（拥有 channel:cs 权限的用户）
  useEffect(() => {
    void (async () => {
      const res = await request.get<ChannelCsAgent[]>('/api/channels/cs/agents', { silent: true });
      if (res.code === 0 && res.data) setAgents(res.data);
    })();
  }, []);

  // 切换频道：重置会话 + 加载快捷回复（会话列表由筛选 effect 负责加载）
  useEffect(() => {
    if (channelId == null) return;
    setConversations([]);
    setActiveUserId(null);
    setMessages([]);
    setQuickReplies([]);
    void fetchQuickReplies(channelId);
  }, [channelId, fetchQuickReplies]);

  // 订阅 WS：用户给运营号发消息时实时刷新
  const handleWs = useCallback((wsMsg: WsMessage) => {
    if (wsMsg.type === 'channel:message-retract') {
      const cid = channelIdRef.current;
      if (cid == null || wsMsg.payload.channelId !== cid) return;
      const uid = activeUserIdRef.current;
      if (uid != null) void fetchMessages(cid, uid);
      return;
    }
    if (wsMsg.type !== 'channel:cs-message') return;
    const cid = channelIdRef.current;
    if (cid == null) return;
    if (wsMsg.payload.channelId === cid) {
      void fetchConversations(cid);
      const uid = activeUserIdRef.current;
      if (uid != null) void fetchMessages(cid, uid);
    } else {
      // 其他频道有新消息：刷新会话列表更新未读角标（仅当前选中频道维度）
      void fetchConversations(cid);
    }
  }, [fetchConversations, fetchMessages]);

  useWebSocket(handleWs);

  // 轮询会话列表（WS 兜底，降频至 30s）
  useEffect(() => {
    if (channelId == null) return;
    const timer = setInterval(() => { void fetchConversations(channelId); }, 30000);
    return () => clearInterval(timer);
  }, [channelId, fetchConversations]);

  // 切换会话：加载消息
  useEffect(() => {
    if (channelId == null || activeUserId == null) return;
    lastCountRef.current = 0;
    void fetchMessages(channelId, activeUserId, true);
  }, [channelId, activeUserId, fetchMessages]);

  // 轮询活动会话消息（WS 兜底，降频至 15s）
  useEffect(() => {
    if (channelId == null || activeUserId == null) return;
    const timer = setInterval(() => { void fetchMessages(channelId, activeUserId); }, 15000);
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

  const insertQuickReply = useCallback((content: string) => {
    setReply((prev) => {
      if (!prev.trim()) return content;
      return prev.endsWith('\n') ? prev + content : `${prev}\n${content}`;
    });
  }, []);

  const refreshAfterOp = useCallback(() => {
    const cid = channelIdRef.current;
    if (cid == null) return;
    void fetchConversations(cid);
    const uid = activeUserIdRef.current;
    if (uid != null) void fetchMessages(cid, uid);
  }, [fetchConversations, fetchMessages]);

  const handleAssign = useCallback(async (assigneeId: number | null) => {
    if (channelId == null || activeUserId == null || opLoading) return;
    setOpLoading(true);
    try {
      const res = await request.post(
        `/api/channels/cs/${channelId}/conversations/${activeUserId}/assign`,
        { assigneeId },
        { silent: true },
      );
      if (res.code === 0) {
        Toast.success(assigneeId == null ? '已取消指派' : '已指派');
        refreshAfterOp();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setOpLoading(false);
    }
  }, [channelId, activeUserId, opLoading, refreshAfterOp]);

  const handleResolve = useCallback(async () => {
    if (channelId == null || activeUserId == null || opLoading) return;
    setOpLoading(true);
    try {
      const res = await request.post(
        `/api/channels/cs/${channelId}/conversations/${activeUserId}/resolve`,
        {},
        { silent: true },
      );
      if (res.code === 0) {
        Toast.success('已标记为已解决');
        refreshAfterOp();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setOpLoading(false);
    }
  }, [channelId, activeUserId, opLoading, refreshAfterOp]);

  const handleSearch = useCallback(() => { setKeyword(keywordInput.trim()); }, [keywordInput]);

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
        <Button icon={<BarChart3 size={14} />} onClick={() => setPerformanceVisible(true)}>
          绩效
        </Button>
      </div>

      {channels.length === 0 ? (
        <Empty description="暂无可服务的运营号" style={{ padding: 60 }} />
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, border: '1px solid var(--semi-color-border)', borderRadius: 8, overflow: 'hidden' }}>
          {/* 会话列表 */}
          <div style={{ width: 320, borderRight: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0 }}>
            {/* 筛选区 */}
            <div style={{ flexShrink: 0, padding: 10, borderBottom: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Input
                value={keywordInput}
                onChange={setKeywordInput}
                onEnterPress={handleSearch}
                prefix={<Search size={14} />}
                placeholder="搜索用户名 / 最后消息"
                showClear
                onClear={() => { setKeywordInput(''); setKeyword(''); }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <Select
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as StatusFilter)}
                  style={{ flex: 1 }}
                  optionList={[
                    { label: '全部状态', value: 'all' },
                    { label: CHANNEL_CONVERSATION_STATUS_LABELS.open, value: 'open' },
                    { label: CHANNEL_CONVERSATION_STATUS_LABELS.processing, value: 'processing' },
                    { label: CHANNEL_CONVERSATION_STATUS_LABELS.resolved, value: 'resolved' },
                  ]}
                />
                <Select
                  value={assigneeFilter}
                  onChange={(v) => setAssigneeFilter(v as AssigneeFilter)}
                  style={{ flex: 1 }}
                  optionList={[
                    { label: '全部归属', value: 'all' },
                    { label: '我的', value: 'mine' },
                    { label: '未分配', value: 'unassigned' },
                  ]}
                />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {conversations.length === 0 ? (
              <Empty description="暂无会话" style={{ padding: 40 }} />
            ) : conversations.map((c) => (
              <div
                key={c.userId}
                onClick={() => setActiveUserId(c.userId)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', cursor: 'pointer',
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
                    <Tag color={STATUS_TAG_COLOR[c.status]} size="small">{CHANNEL_CONVERSATION_STATUS_LABELS[c.status]}</Tag>
                    {c.assigneeName
                      ? <Text type="tertiary" size="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{c.assigneeName}</Text>
                      : <Text type="quaternary" size="small">未分配</Text>}
                  </div>
                  {c.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 2 }}>
                      {c.tags.map((t) => <Tag key={t} size="small" color="grey">{t}</Tag>)}
                    </div>
                  )}
                  <Text type="tertiary" size="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.lastDirection === 'out' ? '我方：' : ''}{c.lastMessage}
                  </Text>
                </div>
              </div>
            ))}
            </div>
          </div>

          {/* 消息流 + 回复框 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {activeConv == null ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="选择左侧会话开始回复" />
              </div>
            ) : (
              <>
                <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text strong>{activeConv.userName}</Text>
                      <Tag color={STATUS_TAG_COLOR[activeConv.status]} size="small">{CHANNEL_CONVERSATION_STATUS_LABELS[activeConv.status]}</Tag>
                      <Text type="tertiary" size="small">
                        {activeConv.assigneeName ? `@${activeConv.assigneeName}` : '未分配'}
                      </Text>
                    </div>
                    <Text type="tertiary" size="small">共 {activeConv.messageCount} 条消息</Text>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <Dropdown
                      trigger="click"
                      position="bottomRight"
                      render={(
                        <Dropdown.Menu style={{ maxHeight: 320, overflowY: 'auto' }}>
                          <Dropdown.Item
                            disabled={activeConv.assigneeId == null || opLoading}
                            onClick={() => void handleAssign(null)}
                          >
                            取消指派
                          </Dropdown.Item>
                          <Dropdown.Divider />
                          {agents.length === 0 ? (
                            <Dropdown.Item disabled>暂无可指派客服</Dropdown.Item>
                          ) : agents.map((a) => (
                            <Dropdown.Item
                              key={a.id}
                              active={activeConv.assigneeId === a.id}
                              disabled={opLoading}
                              onClick={() => void handleAssign(a.id)}
                            >
                              {a.name}
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      )}
                    >
                      <Button theme="borderless" size="small" icon={<UserCheck size={14} />}>指派/转接</Button>
                    </Dropdown>
                    <Button theme="borderless" size="small" icon={<TagIcon size={14} />} onClick={() => setTagModalVisible(true)}>标签</Button>
                    {activeConv.status !== 'resolved' && (
                      <Button theme="borderless" size="small" icon={<CheckCheck size={14} />} loading={opLoading} onClick={() => void handleResolve()}>标记解决</Button>
                    )}
                  </div>
                </div>

                <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 }}>
                  {loadingMsg ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  ) : messages.map((m) => {
                    const isOut = m.direction === 'out';
                    if (m.isRetracted) {
                      return (
                        <div key={m.id} style={{ textAlign: 'center', marginBottom: 14 }}>
                          <Text type="tertiary" size="small">该消息已撤回</Text>
                        </div>
                      );
                    }
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
                        {isOut && m.readByTarget != null && (
                          <Text
                            size="small"
                            style={{ marginTop: 2, color: m.readByTarget ? 'var(--semi-color-text-2)' : 'var(--semi-color-text-3)' }}
                          >
                            {m.readByTarget ? '已读' : '已送达'}
                          </Text>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--semi-color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Dropdown
                      trigger="click"
                      position="topLeft"
                      render={(
                        <Dropdown.Menu style={{ maxHeight: 320, overflowY: 'auto', maxWidth: 360 }}>
                          {quickReplies.length === 0 ? (
                            <Dropdown.Item disabled>暂无快捷回复</Dropdown.Item>
                          ) : quickReplies.map((q) => (
                            <Dropdown.Item key={q.id} onClick={() => insertQuickReply(q.content)}>
                              <div style={{ minWidth: 0 }}>
                                <Text strong size="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</Text>
                                <Text type="tertiary" size="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{q.content}</Text>
                              </div>
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      )}
                    >
                      <Button theme="borderless" size="small" icon={<MessageSquareText size={14} />}>快捷回复</Button>
                    </Dropdown>
                    <Button theme="borderless" size="small" icon={<Settings size={14} />} onClick={() => setManageVisible(true)}>管理快捷回复</Button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
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
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {channelId != null && (
        <ChannelQuickReplyDrawer
          channelId={channelId}
          channelName={channels.find((c) => c.id === channelId)?.name ?? '当前频道'}
          visible={manageVisible}
          onClose={() => setManageVisible(false)}
          onChanged={() => { void fetchQuickReplies(channelId); }}
        />
      )}

      {channelId != null && (
        <ConversationTagModal
          channelId={channelId}
          conversation={activeConv}
          visible={tagModalVisible}
          onClose={() => setTagModalVisible(false)}
          onSaved={refreshAfterOp}
        />
      )}

      <ChannelCsPerformanceDrawer
        visible={performanceVisible}
        onClose={() => setPerformanceVisible(false)}
      />
    </div>
  );
}
