import { useEffect, useState, useCallback, useRef } from 'react';
import { Avatar, Button, Input, Toast, Banner, Spin, Empty, Modal, Select, Typography } from '@douyinfe/semi-ui';
import { RefreshCw, Send, Paperclip } from 'lucide-react';
import type { MpConversation, MpMessage, MpMessageType, MpMaterial, MpDraft } from '@zenith/shared';
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
  const { accounts, currentId, currentIdRef, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [conversations, setConversations] = useState<MpConversation[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [selectedOpenid, setSelectedOpenid] = useState<string | null>(null);

  const [thread, setThread] = useState<MpMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [materials, setMaterials] = useState<MpMaterial[]>([]);
  const [drafts, setDrafts] = useState<MpDraft[]>([]);
  const [mediaModalVisible, setMediaModalVisible] = useState(false);
  const [mediaContentType, setMediaContentType] = useState<'image' | 'voice' | 'video' | 'news'>('image');
  const [mediaId, setMediaId] = useState<string>('');
  const [mediaTitle, setMediaTitle] = useState('');

  const fetchConversations = useCallback(async (accountId: number) => {
    setConvLoading(true);
    try {
      const res = await request.get<MpConversation[]>(`/api/mp/messages/conversations?accountId=${accountId}`);
      if (currentIdRef.current !== accountId) return; // 账号已切换，丢弃过期响应
      setConversations(res.data ?? []);
    } finally {
      setConvLoading(false);
    }
  }, [currentIdRef]);

  const fetchThread = useCallback(async (accountId: number, openid: string) => {
    setThreadLoading(true);
    try {
      const res = await request.get<PaginatedResponse<MpMessage>>(`/api/mp/messages?accountId=${accountId}&openid=${encodeURIComponent(openid)}&page=1&pageSize=50`);
      if (currentIdRef.current !== accountId) return; // 账号已切换，丢弃过期响应
      // 接口按 id 倒序返回，反转为时间正序（旧→新）展示
      setThread([...(res.data?.list ?? [])].reverse());
    } finally {
      setThreadLoading(false);
    }
  }, [currentIdRef]);

  const fetchMedia = useCallback(async (accountId: number) => {
    const [m, d] = await Promise.all([
      request.get<PaginatedResponse<MpMaterial>>(`/api/mp/materials?accountId=${accountId}&page=1&pageSize=200`),
      request.get<PaginatedResponse<MpDraft>>(`/api/mp/drafts?accountId=${accountId}&page=1&pageSize=200`),
    ]);
    if (currentIdRef.current !== accountId) return;
    setMaterials((m.data?.list ?? []).filter((x) => x.wechatMediaId));
    setDrafts((d.data?.list ?? []).filter((x) => x.wechatMediaId));
  }, [currentIdRef]);

  useEffect(() => {
    setSelectedOpenid(null);
    setThread([]);
    if (currentId) { void fetchConversations(currentId); void fetchMedia(currentId); }
    else { setConversations([]); setMaterials([]); setDrafts([]); }
  }, [currentId, fetchConversations, fetchMedia]);

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
      const res = await request.post<MpMessage>('/api/mp/messages/send', { accountId: currentId, openid: selectedOpenid, msgType: 'text', content });
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

  const openMediaModal = () => { setMediaContentType('image'); setMediaId(''); setMediaTitle(''); setMediaModalVisible(true); };

  const handleSendMedia = async () => {
    if (!currentId || !selectedOpenid) return;
    if (!mediaId) { Toast.error('请选择素材'); return; }
    setSending(true);
    try {
      const body: Record<string, unknown> = { accountId: currentId, openid: selectedOpenid, msgType: mediaContentType, mediaId };
      if (mediaContentType === 'video' && mediaTitle) body.content = mediaTitle;
      const res = await request.post<MpMessage>('/api/mp/messages/send', body);
      if (res.code === 0) {
        if (res.data) setThread((prev) => [...prev, res.data]);
        void fetchConversations(currentId);
        setMediaModalVisible(false);
        Toast.success('已发送');
      }
    } finally {
      setSending(false);
    }
  };

  const mediaOptions = mediaContentType === 'news'
    ? drafts.map((d) => ({ label: `${d.title}（${d.wechatMediaId}）`, value: d.wechatMediaId as string }))
    : materials.filter((m) => m.type === mediaContentType).map((m) => ({ label: `${m.name}（${m.wechatMediaId}）`, value: m.wechatMediaId as string }));

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
          <Button icon={<Paperclip size={14} />} disabled={!selectedOpenid || sending} onClick={openMediaModal} title="发送图片/语音/视频/图文" />
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

      <Modal title="发送素材消息" visible={mediaModalVisible} onOk={() => void handleSendMedia()} onCancel={() => setMediaModalVisible(false)}
        okText="发送" confirmLoading={sending} okButtonProps={{ disabled: !mediaId }} width={460}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Typography.Text type="secondary" size="small">消息类型</Typography.Text>
            <Select style={{ width: '100%', marginTop: 4 }} value={mediaContentType}
              onChange={(v) => { setMediaContentType(v as 'image' | 'voice' | 'video' | 'news'); setMediaId(''); }}
              optionList={[
                { label: '图片', value: 'image' },
                { label: '语音', value: 'voice' },
                { label: '视频', value: 'video' },
                { label: '图文', value: 'news' },
              ]} />
          </div>
          <div>
            <Typography.Text type="secondary" size="small">{mediaContentType === 'news' ? '图文素材（已推送到微信的草稿）' : '素材（素材库永久素材）'}</Typography.Text>
            <Select style={{ width: '100%', marginTop: 4 }} value={mediaId || undefined} onChange={(v) => setMediaId(v as string)}
              filter showClear placeholder="请选择" optionList={mediaOptions}
              emptyContent={mediaContentType === 'news' ? '暂无可用图文草稿（需已推送到微信）' : '暂无对应类型的永久素材'} />
          </div>
          {mediaContentType === 'video' && (
            <div>
              <Typography.Text type="secondary" size="small">视频标题（可选）</Typography.Text>
              <Input style={{ marginTop: 4 }} value={mediaTitle} onChange={setMediaTitle} placeholder="可选" />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
