import { useEffect, useState, useCallback, useRef } from 'react';
import { Avatar, Button, Input, Toast, Banner, Spin, Empty } from '@douyinfe/semi-ui';
import { RefreshCw, Send } from 'lucide-react';
import type { MpConversation, MpMessage, MpMessageType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import type { PaginatedResponse } from '@zenith/shared';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

function msgPreview(type: MpMessageType, content: string | null): string {
  switch (type) {
    case 'text': return content || '';
    case 'image': return '[图片]';
    case 'voice': return '[语音]';
    case 'video':
    case 'shortvideo': return '[视频]';
    case 'location': return '[位置]';
    case 'link': return '[链接]';
    case 'event': return `[事件] ${content ?? ''}`.trim();
    default: return content || '';
  }
}

export default function MpMessagesPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [conversations, setConversations] = useState<MpConversation[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [selectedOpenid, setSelectedOpenid] = useState<string | null>(null);

  const [thread, setThread] = useState<MpMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async (accountId: number) => {
    setConvLoading(true);
    try {
      const res = await request.get<MpConversation[]>(`/api/mp/messages/conversations?accountId=${accountId}`);
      setConversations(res.data ?? []);
    } finally {
      setConvLoading(false);
    }
  }, []);

  const fetchThread = useCallback(async (accountId: number, openid: string) => {
    setThreadLoading(true);
    try {
      const res = await request.get<PaginatedResponse<MpMessage>>(`/api/mp/messages?accountId=${accountId}&openid=${encodeURIComponent(openid)}&page=1&pageSize=50`);
      // 接口按 id 倒序返回，反转为时间正序（旧→新）展示
      setThread([...(res.data?.list ?? [])].reverse());
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedOpenid(null);
    setThread([]);
    if (currentId) void fetchConversations(currentId);
    else setConversations([]);
  }, [currentId, fetchConversations]);

  useEffect(() => {
    if (currentId && selectedOpenid) void fetchThread(currentId, selectedOpenid);
  }, [currentId, selectedOpenid, fetchThread]);

  useEffect(() => {
    // 新消息后滚动到底部
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [thread]);

  const handleSend = async () => {
    const content = reply.trim();
    if (!content || !currentId || !selectedOpenid) return;
    setSending(true);
    try {
      const res = await request.post<MpMessage>('/api/mp/messages/send', { accountId: currentId, openid: selectedOpenid, content });
      if (res.code === 0) {
        setReply('');
        if (res.data) setThread((prev) => [...prev, res.data]);
        void fetchConversations(currentId);
        Toast.success('已发送');
      }
    } finally {
      setSending(false);
    }
  };

  const selectedConv = conversations.find((c) => c.openid === selectedOpenid) ?? null;

  const master = (
    <NavListPanel
      title="会话"
      headerExtra={(
        <Button icon={<RefreshCw size={13} />} size="small" theme="borderless" loading={convLoading}
          disabled={!currentId} onClick={() => currentId && void fetchConversations(currentId)} />
      )}
      loading={convLoading}
      emptyText="暂无会话，等待粉丝发起消息"
      dataSource={conversations}
      renderItem={(c: MpConversation) => (
        <NavListItem
          key={c.openid}
          active={c.openid === selectedOpenid}
          onClick={() => setSelectedOpenid(c.openid)}
          icon={<Avatar size="extra-small" src={c.avatar ?? undefined} color="blue">{(c.nickname ?? c.openid).slice(0, 1)}</Avatar>}
          primary={c.nickname || c.openid}
          meta={(
            <>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.lastDirection === 'out' ? '我: ' : ''}{msgPreview(c.lastMsgType, c.lastContent)}
              </span>
              <span style={{ flexShrink: 0, color: 'var(--semi-color-text-2)' }}>{c.lastTime.slice(5, 16)}</span>
            </>
          )}
        />
      )}
    />
  );

  const detail = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid var(--semi-color-border)', minHeight: 44, display: 'flex', alignItems: 'center' }}>
        {selectedConv
          ? <span style={{ fontWeight: 600 }}>{selectedConv.nickname || selectedConv.openid}<span style={{ color: 'var(--semi-color-text-2)', fontWeight: 400, marginLeft: 8 }}>共 {selectedConv.messageCount} 条</span></span>
          : <span style={{ color: 'var(--semi-color-text-2)' }}>选择左侧会话查看消息</span>}
      </div>
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, background: 'var(--semi-color-fill-0)' }}>
        {!selectedOpenid ? (
          <Empty description="请选择一个会话" style={{ paddingTop: 80 }} />
        ) : threadLoading ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}><Spin /></div>
        ) : (
          thread.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'out' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
              <div style={{
                maxWidth: '70%', padding: '8px 12px', borderRadius: 8, wordBreak: 'break-word', fontSize: 13, lineHeight: 1.5,
                background: m.direction === 'out' ? 'var(--semi-color-primary)' : 'var(--semi-color-bg-2)',
                color: m.direction === 'out' ? '#fff' : 'var(--semi-color-text-0)',
              }}>
                <div>{msgPreview(m.msgType, m.content)}</div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: 'right' }}>{m.createdAt.slice(5, 16)}</div>
              </div>
            </div>
          ))
        )}
      </div>
      {can('mp:message:send') && (
        <div style={{ flexShrink: 0, padding: 12, borderTop: '1px solid var(--semi-color-border)', display: 'flex', gap: 8 }}>
          <Input
            value={reply}
            onChange={setReply}
            onEnterPress={() => void handleSend()}
            disabled={!selectedOpenid || sending}
            placeholder={selectedOpenid ? '输入客服消息，回车发送（需粉丝48小时内有互动）' : '请先选择会话'}
          />
          <Button type="primary" icon={<Send size={14} />} loading={sending} disabled={!selectedOpenid || !reply.trim()} onClick={() => void handleSend()}>发送</Button>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 0 12px' }}>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        {!accountsLoading && accounts.length === 0 && (
          <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" />
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MasterDetailLayout
          bordered
          defaultSize={300}
          minSize={240}
          maxSize={460}
          persistKey="mp-messages"
          showDetail={selectedOpenid !== null}
          onBack={() => setSelectedOpenid(null)}
          style={{ height: '100%' }}
          master={master}
          detail={detail}
        />
      </div>
    </div>
  );
}
