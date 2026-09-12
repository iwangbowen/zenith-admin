import { useState } from 'react';
import { Button, DatePicker, Dropdown, Empty, Input, List as SemiList, Popconfirm, Space, Spin, Tag, TextArea, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { CalendarClock, MessageSquareQuote, Pencil, Plus } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { formatDateTimeForApi } from '@/utils/date';
import {
  useCancelScheduledMessage,
  useChatQuickReplies,
  useCreateScheduledMessage,
  useDeleteChatQuickReply,
  useMyScheduledMessages,
  useSaveChatQuickReply,
} from '@/hooks/queries/chat';
import type { ChatScheduledMessage } from '@zenith/shared/chat';

const { Text } = Typography;

const SCHEDULED_STATUS_META: Record<ChatScheduledMessage['status'], { label: string; color: 'blue' | 'green' | 'grey' | 'red' }> = {
  pending: { label: '待发送', color: 'blue' },
  sent: { label: '已发送', color: 'green' },
  canceled: { label: '已取消', color: 'grey' },
  failed: { label: '发送失败', color: 'red' },
};

/** 输入区扩展工具：常用语（快捷回复）+ 定时消息 */
export function ComposerExtras({
  conversationId, draft, onInsert, onScheduled,
}: Readonly<{
  conversationId: number | null;
  /** 当前输入框草稿，作为定时消息的默认内容 */
  draft: string;
  /** 选择常用语后插入输入框 */
  onInsert: (text: string) => void;
  /** 定时消息创建成功（用于清空输入框） */
  onScheduled: () => void;
}>) {
  // ── 常用语 ──
  const [quickOpen, setQuickOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const quickQuery = useChatQuickReplies(quickOpen || manageOpen);
  const saveQuickMutation = useSaveChatQuickReply();
  const deleteQuickMutation = useDeleteChatQuickReply();
  const quickReplies = quickQuery.data ?? [];

  // ── 定时消息 ──
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleContent, setScheduleContent] = useState('');
  const [scheduleAt, setScheduleAt] = useState<Date | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const scheduledQuery = useMyScheduledMessages(listOpen);
  const createScheduledMutation = useCreateScheduledMessage();
  const cancelScheduledMutation = useCancelScheduledMessage();

  const handleSaveQuick = async () => {
    const content = editContent.trim();
    if (!content) { Toast.warning('内容不能为空'); return; }
    try {
      await saveQuickMutation.mutateAsync({ id: editingId ?? undefined, values: { content } });
    } catch {
      return;
    }
    Toast.success(editingId ? '已更新' : '已添加');
    setEditingId(null);
    setEditContent('');
  };

  const handleCreateScheduled = async () => {
    if (!conversationId) return;
    const content = scheduleContent.trim();
    if (!content) { Toast.warning('消息内容不能为空'); return; }
    if (!scheduleAt) { Toast.warning('请选择发送时间'); return; }
    try {
      await createScheduledMutation.mutateAsync({
        params: { id: conversationId },
        body: { content, scheduledAt: formatDateTimeForApi(scheduleAt) },
      });
    } catch {
      return;
    }
    Toast.success('定时消息已创建');
    setScheduleOpen(false);
    setScheduleContent('');
    setScheduleAt(null);
    onScheduled();
  };

  return (
    <>
      <Dropdown
        trigger="custom"
        visible={quickOpen}
        onClickOutSide={() => setQuickOpen(false)}
        position="topLeft"
        render={(
          <Dropdown.Menu style={{ width: 260, maxHeight: 280, overflowY: 'auto' }}>
            <Dropdown.Title>常用语</Dropdown.Title>
            {quickQuery.isLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}><Spin size="small" /></div>
            )}
            {!quickQuery.isLoading && quickReplies.length === 0 && (
              <Text type="tertiary" style={{ display: 'block', padding: '8px 12px', fontSize: 12 }}>暂无常用语，点击下方管理添加</Text>
            )}
            {quickReplies.map((q) => (
              <Dropdown.Item
                key={q.id}
                onClick={() => { onInsert(q.content); setQuickOpen(false); }}
                style={{ whiteSpace: 'normal', lineHeight: 1.4 }}
              >
                <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12 }}>{q.content}</span>
              </Dropdown.Item>
            ))}
            <Dropdown.Divider />
            <Dropdown.Item icon={<Pencil size={13} />} onClick={() => { setQuickOpen(false); setManageOpen(true); }}>
              管理常用语
            </Dropdown.Item>
          </Dropdown.Menu>
        )}
      >
        <span>
          <Tooltip content="常用语">
            <Button
              size="small" theme="borderless" type="tertiary"
              icon={<MessageSquareQuote size={16} />}
              disabled={!conversationId}
              onClick={() => setQuickOpen((v) => !v)}
            />
          </Tooltip>
        </span>
      </Dropdown>

      <Tooltip content="定时发送">
        <Button
          size="small" theme="borderless" type="tertiary"
          icon={<CalendarClock size={16} />}
          disabled={!conversationId}
          onClick={() => { setScheduleContent(draft); setScheduleOpen(true); }}
        />
      </Tooltip>

      {/* 常用语管理 */}
      <AppModal
        title="管理常用语"
        visible={manageOpen}
        onCancel={() => { setManageOpen(false); setEditingId(null); setEditContent(''); }}
        footer={null}
        width={480}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            placeholder={editingId ? '编辑常用语内容' : '输入新常用语（最多 500 字）'}
            value={editContent}
            onChange={setEditContent}
            maxLength={500}
            onEnterPress={() => { void handleSaveQuick(); }}
          />
          <Button
            type="primary"
            icon={editingId ? <Pencil size={14} /> : <Plus size={14} />}
            loading={saveQuickMutation.isPending}
            onClick={() => { void handleSaveQuick(); }}
          >
            {editingId ? '保存' : '添加'}
          </Button>
          {editingId !== null && (
            <Button type="tertiary" onClick={() => { setEditingId(null); setEditContent(''); }}>取消</Button>
          )}
        </div>
        <SemiList
          dataSource={quickReplies}
          loading={quickQuery.isFetching}
          emptyContent={<Empty description="暂无常用语" imageStyle={{ width: 64 }} />}
          renderItem={(q) => (
            <SemiList.Item
              key={q.id}
              main={<Text style={{ fontSize: 13, wordBreak: 'break-word' }}>{q.content}</Text>}
              extra={(
                <Space spacing={4}>
                  <Button theme="borderless" size="small" onClick={() => { setEditingId(q.id); setEditContent(q.content); }}>编辑</Button>
                  <Popconfirm title="确定要删除吗？" onConfirm={() => { void deleteQuickMutation.mutateAsync({ params: { id: q.id } }).then(() => Toast.success('已删除')).catch(() => undefined); }}>
                    <Button theme="borderless" type="danger" size="small">删除</Button>
                  </Popconfirm>
                </Space>
              )}
            />
          )}
        />
      </AppModal>

      {/* 创建定时消息 */}
      <AppModal
        title="定时发送"
        visible={scheduleOpen}
        onCancel={() => setScheduleOpen(false)}
        onOk={() => { void handleCreateScheduled(); }}
        okText="创建定时消息"
        confirmLoading={createScheduledMutation.isPending}
        width={480}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TextArea
            placeholder="消息内容"
            rows={4}
            maxCount={4096}
            value={scheduleContent}
            onChange={setScheduleContent}
          />
          <DatePicker
            type="dateTime"
            placeholder="选择发送时间（1 分钟后 ~ 30 天内）"
            value={scheduleAt ?? undefined}
            onChange={(v) => setScheduleAt(v instanceof Date ? v : null)}
            style={{ width: '100%' }}
            disabledDate={(d) => !!d && d.getTime() < Date.now() - 24 * 3600 * 1000}
          />
          <Button theme="borderless" type="tertiary" size="small" style={{ alignSelf: 'flex-start' }} onClick={() => setListOpen(true)}>
            查看我的定时消息
          </Button>
        </div>
      </AppModal>

      {/* 定时消息列表 */}
      <AppModal
        title="我的定时消息"
        visible={listOpen}
        onCancel={() => setListOpen(false)}
        footer={null}
        width={560}
      >
        <SemiList
          dataSource={scheduledQuery.data ?? []}
          loading={scheduledQuery.isFetching}
          emptyContent={<Empty description="暂无定时消息" imageStyle={{ width: 64 }} />}
          renderItem={(item) => {
            const meta = SCHEDULED_STATUS_META[item.status];
            return (
              <SemiList.Item
                key={item.id}
                main={(
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Tag size="small" color={meta.color}>{meta.label}</Tag>
                      <Text type="tertiary" style={{ fontSize: 12 }}>发往：{item.conversationName ?? `会话 ${item.conversationId}`}</Text>
                      <Text type="tertiary" style={{ fontSize: 12 }}>时间：{item.scheduledAt}</Text>
                    </div>
                    <Text style={{ fontSize: 13, wordBreak: 'break-word' }}>{item.content}</Text>
                    {item.status === 'failed' && item.failReason && (
                      <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>失败原因：{item.failReason}</Text>
                    )}
                  </div>
                )}
                extra={item.status === 'pending' && (
                  <Popconfirm title="确定取消该定时消息？" onConfirm={() => { void cancelScheduledMutation.mutateAsync({ params: { id: item.id } }).then(() => Toast.success('已取消')).catch(() => undefined); }}>
                    <Button theme="borderless" type="danger" size="small">取消</Button>
                  </Popconfirm>
                )}
              />
            );
          }}
        />
      </AppModal>
    </>
  );
}
