/**
 * 频道消息记录抽屉
 *
 * 展示某频道的群发消息记录，支持按状态筛选（全部 / 已发 / 草稿 / 定时）。
 * 草稿与定时消息可编辑、删除、立即发送；已发消息只读。
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, SideSheet, Table, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ChannelAdmin, ChannelMessage, ChannelMessageStatus, PaginatedResponse } from '@zenith/shared';
import { CHANNEL_MESSAGE_STATUS_LABELS, CHANNEL_MESSAGE_TYPE_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { ChannelPublishModal } from './ChannelPublishModal';

interface Props {
  channel: ChannelAdmin | null;
  visible: boolean;
  onClose: () => void;
}

type TabKey = 'all' | 'sent' | 'draft' | 'scheduled';

const STATUS_COLOR: Record<ChannelMessageStatus, 'green' | 'orange' | 'blue'> = {
  sent: 'green',
  draft: 'orange',
  scheduled: 'blue',
};

const AUDIENCE_TEXT: Record<string, string> = {
  broadcast: '全员',
  targeted: '定向',
};

const PAGE_SIZE = 10;

export function ChannelMessagesDrawer({ channel, visible, onClose }: Readonly<Props>) {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('channel:message:publish');

  const [tab, setTab] = useState<TabKey>('all');
  const [list, setList] = useState<ChannelMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<ChannelMessage | null>(null);
  const [editVisible, setEditVisible] = useState(false);

  const fetchList = useCallback(async (p = 1, t: TabKey = 'all') => {
    if (!channel) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (t !== 'all') params.set('status', t);
      const res = await request.get<PaginatedResponse<ChannelMessage>>(
        `/api/channels/admin/${channel.id}/messages?${params.toString()}`,
        { silent: true },
      );
      if (res.code === 0 && res.data) {
        setList(res.data.list);
        setTotal(res.data.total);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    if (visible) {
      setTab('all');
      setPage(1);
      void fetchList(1, 'all');
    }
  }, [visible, fetchList]);

  const handleTabChange = (key: string) => {
    const next = key as TabKey;
    setTab(next);
    setPage(1);
    void fetchList(1, next);
  };

  const openEdit = (m: ChannelMessage) => { setEditing(m); setEditVisible(true); };

  const handleDelete = async (m: ChannelMessage) => {
    const res = await request.delete(`/api/channels/admin/messages/${m.id}`);
    if (res.code === 0) { Toast.success('已删除'); void fetchList(page, tab); }
  };

  const handleSendNow = async (m: ChannelMessage) => {
    const res = await request.post(`/api/channels/admin/messages/${m.id}/publish`);
    if (res.code === 0) { Toast.success('已发送'); void fetchList(page, tab); }
  };

  const handleRetract = async (m: ChannelMessage) => {
    const res = await request.post(`/api/channels/admin/messages/${m.id}/retract`);
    if (res.code === 0) { Toast.success('已撤回'); void fetchList(page, tab); }
  };

  const columns: ColumnProps<ChannelMessage>[] = [
    {
      title: '类型', dataIndex: 'type', width: 70,
      render: (v: ChannelMessage['type']) => (
        <Tag size="small" color={v === 'news' ? 'blue' : 'grey'}>{CHANNEL_MESSAGE_TYPE_LABELS[v] ?? v}</Tag>
      ),
    },
    {
      title: '内容', dataIndex: 'content',
      render: (_: string, r: ChannelMessage) => (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>
          {r.title ? `${r.title} · ` : ''}{r.content || '—'}
        </Typography.Text>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: ChannelMessageStatus, r: ChannelMessage) => (
        r.isRetracted
          ? <Tag size="small" color="grey">已撤回</Tag>
          : <Tag size="small" color={STATUS_COLOR[v] ?? 'grey'}>{CHANNEL_MESSAGE_STATUS_LABELS[v] ?? v}</Tag>
      ),
    },
    {
      title: '受众', dataIndex: 'audienceType', width: 70,
      render: (v: string) => <Typography.Text type="tertiary">{AUDIENCE_TEXT[v] ?? v}</Typography.Text>,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 175, render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(v)}</span> },
    {
      title: '定时时间', dataIndex: 'scheduledAt', width: 175,
      render: (v: string | null) => (v ? <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(v)}</span> : <Typography.Text type="tertiary">—</Typography.Text>),
    },
    createOperationColumn<ChannelMessage>({
      width: 160,
      emptyContent: <Typography.Text type="tertiary">—</Typography.Text>,
      actions: (record) => {
        if (!canManage) return [];
        if (record.status === 'sent') {
          return [
            {
              key: 'retract',
              label: '撤回',
              danger: true,
              hidden: record.isRetracted,
              onClick: () => {
                Modal.confirm({
                  title: '确定撤回？撤回后用户将看不到此消息',
                  okButtonProps: { type: 'danger', theme: 'solid' },
                  onOk: () => { void handleRetract(record); },
                });
              },
            },
          ];
        }
        return [
          {
            key: 'edit',
            label: '编辑',
            onClick: () => openEdit(record),
          },
          {
            key: 'send-now',
            label: '立即发送',
            onClick: () => {
              Modal.confirm({
                title: '确定立即发送该消息？',
                onOk: () => { void handleSendNow(record); },
              });
            },
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              Modal.confirm({
                title: '确定删除该消息？',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => { void handleDelete(record); },
              });
            },
          },
        ];
      },
    }),
  ];

  return (
    <SideSheet
      title={`消息记录 · ${channel?.name ?? ''}`}
      visible={visible}
      onCancel={onClose}
      width={920}
      placement="right"
    >
      <Tabs type="line" activeKey={tab} onChange={handleTabChange}>
        <TabPane tab="全部" itemKey="all" />
        <TabPane tab="已发送" itemKey="sent" />
        <TabPane tab="草稿" itemKey="draft" />
        <TabPane tab="定时" itemKey="scheduled" />
      </Tabs>
      <Table
        columns={columns}
        dataSource={list}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{
          currentPage: page,
          pageSize: PAGE_SIZE,
          total,
          onPageChange: (p: number) => { setPage(p); void fetchList(p, tab); },
        }}
      />

      <ChannelPublishModal
        channel={channel}
        editing={editing}
        visible={editVisible}
        onClose={() => { setEditVisible(false); setEditing(null); }}
        onSuccess={() => void fetchList(page, tab)}
      />
    </SideSheet>
  );
}

export default ChannelMessagesDrawer;
