import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Input, Toast, Banner, Spin, Empty, Select, Typography } from '@douyinfe/semi-ui';
import { RefreshCw, Send, Paperclip } from 'lucide-react';
import type { MpConversation, MpMessage, MpMessageType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import AppModal from '@/components/AppModal';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  useMpConversations,
  useMpMessageMediaOptions,
  useMpMessageThread,
  useSendMpMessage,
} from '@/hooks/queries/mp-messages';

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
  const [selectedOpenid, setSelectedOpenid] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const [mediaModalVisible, setMediaModalVisible] = useState(false);
  const [mediaContentType, setMediaContentType] = useState<'image' | 'voice' | 'video' | 'news'>('image');
  const [mediaId, setMediaId] = useState<string>('');
  const [mediaTitle, setMediaTitle] = useState('');

  const conversationsQuery = useMpConversations(currentId);
  const threadQuery = useMpMessageThread(currentId, selectedOpenid);
  const mediaQuery = useMpMessageMediaOptions(currentId);
  const sendMutation = useSendMpMessage();
  const conversations = conversationsQuery.data ?? [];
  const thread = threadQuery.data;
  const materials = mediaQuery.data?.materials ?? [];
  const drafts = mediaQuery.data?.drafts ?? [];

  useEffect(() => {
    setSelectedOpenid(null);
  }, [currentId]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [thread]);

  const handleSend = async () => {
    const content = reply.trim();
    if (!content || !currentId || !selectedOpenid) return;
    await sendMutation.mutateAsync({ accountId: currentId, openid: selectedOpenid, msgType: 'text', content });
    setReply('');
    Toast.success('已发送');
  };

  const openMediaModal = () => { setMediaContentType('image'); setMediaId(''); setMediaTitle(''); setMediaModalVisible(true); };

  const handleSendMedia = async () => {
    if (!currentId || !selectedOpenid) return;
    if (!mediaId) { Toast.error('请选择素材'); return; }
    const body: Record<string, unknown> = { accountId: currentId, openid: selectedOpenid, msgType: mediaContentType, mediaId };
    if (mediaContentType === 'video' && mediaTitle) body.content = mediaTitle;
    await sendMutation.mutateAsync(body);
    setMediaModalVisible(false);
    Toast.success('已发送');
  };

  const mediaOptions = mediaContentType === 'news'
    ? drafts.map((d) => ({ label: `${d.title}（${d.wechatMediaId}）`, value: d.wechatMediaId as string }))
    : materials.filter((m) => m.type === mediaContentType).map((m) => ({ label: `${m.name}（${m.wechatMediaId}）`, value: m.wechatMediaId as string }));

  const selectedConv = conversations.find((c) => c.openid === selectedOpenid) ?? null;
  const sending = sendMutation.isPending;

  const master = (
    <NavListPanel
      title="会话"
      headerExtra={(
        <Button icon={<RefreshCw size={13} />} size="small" theme="borderless" loading={conversationsQuery.isFetching}
          disabled={!currentId} onClick={() => void conversationsQuery.refetch()} />
      )}
      loading={conversationsQuery.isFetching}
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
        ) : threadQuery.isFetching ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}><Spin /></div>
        ) : (
          (thread ?? []).map((m: MpMessage) => (
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

      <AppModal title="发送素材消息" visible={mediaModalVisible} onOk={() => void handleSendMedia()} onCancel={() => setMediaModalVisible(false)}
        okText="发送" okButtonProps={{ loading: sending, disabled: !mediaId }} width={460}>
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
      </AppModal>
    </div>
  );
}
