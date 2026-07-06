import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppModal } from '@/components/AppModal';
import {
  Button, Tag, Space, Tabs, TabPane, Toast, Empty, Badge, Popconfirm, Spin,
} from '@douyinfe/semi-ui';
import { usePagination } from '@/hooks/usePagination';
import { IllustrationIdle, IllustrationIdleDark } from '@douyinfe/semi-illustrations';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { CheckCheck, Trash2 } from 'lucide-react';
import type { InAppMessage } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import {
  inboxKeys,
  useBatchDeleteInboxMessages,
  useBatchMarkInboxMessagesRead,
  useDeleteInboxMessage,
  useInboxList,
  useInboxMessageDetail,
  useMarkAllInboxMessagesRead,
  useMarkInboxMessageRead,
} from '@/hooks/queries/inbox';

const TYPE_COLOR: Record<string, TagColor> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

const TYPE_LABEL: Record<string, string> = {
  info: '通知',
  success: '成功',
  warning: '警告',
  error: '错误',
};

export default function InboxPage() {
  const queryClient = useQueryClient();
  const { page, setPage } = usePagination();
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read'>('all');

  const [selected, setSelected] = useState<InAppMessage | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  let isRead: string | undefined;
  if (activeTab === 'unread') isRead = 'false';
  else if (activeTab === 'read') isRead = 'true';

  const listParams = { page, pageSize: 10, isRead };
  const listQuery = useInboxList(listParams);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useInboxMessageDetail(selected?.id, selected !== null);
  const selectedMessage = selected ? (detailQuery.data ? { ...detailQuery.data, isRead: true } : selected) : null;
  const markReadMutation = useMarkInboxMessageRead();
  const markAllReadMutation = useMarkAllInboxMessagesRead();
  const deleteMutation = useDeleteInboxMessage();
  const batchReadMutation = useBatchMarkInboxMessagesRead();
  const batchDeleteMutation = useBatchDeleteInboxMessages();
  const loading = listQuery.isFetching;
  const detailLoading = detailQuery.isFetching;
  const markAllLoading = markAllReadMutation.isPending;

  const openMessage = async (item: InAppMessage) => {
    if (!item.isRead) {
      await markReadMutation.mutateAsync(item.id);
      queryClient.setQueryData(inboxKeys.list(listParams), (old: typeof listQuery.data) =>
        old ? { ...old, list: old.list.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)) } : old,
      );
    }
    setSelected({ ...item, isRead: true });
  };

  const handleMarkAllRead = async () => {
    await markAllReadMutation.mutateAsync();
    Toast.success('已全部标记为已读');
    setPage(1);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    Toast.success('已删除');
  };

  const handleBatchRead = async () => {
    await batchReadMutation.mutateAsync(selectedIds);
    setSelectedIds([]);
    Toast.success('已标记为已读');
  };

  const handleBatchDelete = async () => {
    await batchDeleteMutation.mutateAsync(selectedIds);
    setSelectedIds([]);
    Toast.success('已删除');
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key as 'all' | 'unread' | 'read');
    setSelectedIds([]);
    setPage(1);
  };

  const unreadCount = list.filter((n) => !n.isRead).length;

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string, record: InAppMessage) => (
        <Button
          theme="borderless"
          size="small"
          style={{ fontWeight: record.isRead ? 400 : 600, padding: 0 }}
          onClick={() => void openMessage(record)}
        >
          {!record.isRead && (
            <Badge dot style={{ marginRight: 6, verticalAlign: 'middle' }} />
          )}
          {v}
        </Button>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (v: string) => (
        <Tag color={TYPE_COLOR[v] ?? 'blue'} size="small">{TYPE_LABEL[v] ?? v}</Tag>
      ),
    },
    {
      title: '发送人',
      dataIndex: 'senderName',
      width: 140,
      render: (v: string | null | undefined) => v ?? '系统',
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'isRead',
      width: 80,
      render: (v: boolean) => (
        <Tag color={v ? 'grey' : 'blue'} size="small">{v ? '已读' : '未读'}</Tag>
      ),
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right' as const,
      render: (_: unknown, record: InAppMessage) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => void openMessage(record)}>
            查看
          </Button>
          <Popconfirm title="确定要删除吗？" onConfirm={() => void handleDelete(record.id)}>
            <Button theme="borderless" type="danger" size="small">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tabs activeKey={activeTab} onChange={handleTabChange} style={{ marginBottom: 0, flex: 1 }}>
            <TabPane tab="全部" itemKey="all" />
            <TabPane
              tab={
                <Space spacing={4}>
                  <span>未读</span>
                  {activeTab === 'all' && unreadCount > 0 && (
                    <Tag color="red" size="small">{unreadCount}</Tag>
                  )}
                </Space>
              }
              itemKey="unread"
            />
            <TabPane tab="已读" itemKey="read" />
          </Tabs>
          <Space>
            {selectedIds.length > 0 && activeTab !== 'read' && (
              <Button
                icon={<CheckCheck size={14} />}
                loading={batchReadMutation.isPending}
                onClick={() => void handleBatchRead()}
              >
                标记已读 ({selectedIds.length})
              </Button>
            )}
            {selectedIds.length > 0 && (
              <Popconfirm
                title={`确定要删除选中的 ${selectedIds.length} 条消息吗？`}
                onConfirm={() => void handleBatchDelete()}
              >
                <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={batchDeleteMutation.isPending}>
                  批量删除 ({selectedIds.length})
                </Button>
              </Popconfirm>
            )}
            <Button
              type="primary"
              icon={<CheckCheck size={14} />}
              loading={markAllLoading}
              onClick={handleMarkAllRead}
              style={{ visibility: activeTab === 'read' ? 'hidden' : 'visible' }}
            >
              全部标记为已读
            </Button>
          </Space>
        </div>

      {list.length === 0 && !loading ? (
        <Empty
          image={<IllustrationIdle style={{ width: 120, height: 120 }} />}
          darkModeImage={<IllustrationIdleDark style={{ width: 120, height: 120 }} />}
          description={(() => {
            if (activeTab === 'unread') return '暂无未读站内信';
            if (activeTab === 'read') return '暂无已读站内信';
            return '暂无站内信';
          })()}
          style={{ padding: '48px 0' }}
        />
      ) : (
        <ConfigurableTable
          bordered
          loading={loading}
          onRefresh={() => void listQuery.refetch()}
          refreshLoading={loading}
          dataSource={list}
          rowKey="id"
          columns={columns}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds((keys ?? []) as number[]),
          }}
          pagination={{
            total,
            currentPage: page,
            pageSize: 10,
            showSizeChanger: false,
            onPageChange: (p) => {
              setPage(p);
              setSelectedIds([]);
            },
          }}
          onRow={(record) => ({
            style: { opacity: (record as InAppMessage).isRead ? 0.7 : 1 },
          })}
        />
      )}

      <AppModal
        title={selectedMessage?.title ?? ''}
        visible={selectedMessage !== null}
        onCancel={() => setSelected(null)}
        footer={null}
        width={640}
        closeOnEsc
      >
        <Spin spinning={detailLoading} tip="加载中..." size="small">
          {selectedMessage && (
            <div>
              <div style={{ marginBottom: 12, color: 'var(--semi-color-text-3)', fontSize: 12 }}>
                {selectedMessage.senderName ?? '系统'} · {formatDateTime(selectedMessage.createdAt)}
              </div>
              <div style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {selectedMessage.content}
              </div>
            </div>
          )}
        </Spin>
      </AppModal>
    </div>
  );
}
