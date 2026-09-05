import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppModal } from '@/components/AppModal';
import {
  Button, Tag, Space, Tabs, TabPane, Toast, Empty, Badge, Popconfirm, Spin, Typography, List, Checkbox,
} from '@douyinfe/semi-ui';
import { usePagination } from '@/hooks/usePagination';
import { IllustrationIdle, IllustrationIdleDark } from '@douyinfe/semi-illustrations';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { CheckCheck, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { InAppMessage } from '@zenith/shared/messaging';
import { formatDateTime } from '@/utils/date';
import { RefreshButton } from '@/components/toolbar-controls';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ListPagination } from '@/components/ListPagination';
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
import { useMyInAppMessageUnreadCount } from '@/hooks/queries/in-app-messages';

import { useUrlTabState } from '@/hooks/useUrlTabState';
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

const { Text } = Typography;

export default function InboxPage() {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [activeTab, setActiveTab] = useUrlTabState(['all', 'unread', 'read'] as const, 'all');

  const [selected, setSelected] = useState<InAppMessage | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  let isRead: boolean | undefined;
  if (activeTab === 'unread') isRead = false;
  else if (activeTab === 'read') isRead = true;

  const listParams = { page, pageSize, isRead };
  const listQuery = useInboxList(listParams);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const pagination = buildPagination(total);
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

  const openMessage = async (item: InAppMessage, index?: number) => {
    if (!item.isRead) {
      await markReadMutation.mutateAsync({ params: { id: item.id } });
      queryClient.setQueryData(inboxKeys.list(listParams), (old: typeof listQuery.data) =>
        old ? { ...old, list: old.list.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)) } : old,
      );
    }
    setSelectedIndex(index ?? list.findIndex((n) => n.id === item.id));
    setSelected({ ...item, isRead: true });
  };

  const handlePrev = () => {
    if (selectedIndex > 0) void openMessage(list[selectedIndex - 1], selectedIndex - 1);
  };

  const handleNext = () => {
    if (selectedIndex < list.length - 1) void openMessage(list[selectedIndex + 1], selectedIndex + 1);
  };

  const handleMarkAllRead = async () => {
    await markAllReadMutation.mutateAsync({});
    Toast.success('已全部标记为已读');
    setPage(1);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync({ params: { id } });
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    Toast.success('已删除');
  };

  const handleBatchRead = async () => {
    await batchReadMutation.mutateAsync({ body: { ids: selectedIds } });
    setSelectedIds([]);
    Toast.success('已标记为已读');
  };

  const handleBatchDelete = async () => {
    await batchDeleteMutation.mutateAsync({ body: { ids: selectedIds } });
    setSelectedIds([]);
    Toast.success('已删除');
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key as 'all' | 'unread' | 'read');
    setSelectedIds([]);
    setPage(1);
  };

  const unreadCount = useMyInAppMessageUnreadCount().data ?? 0;
  const allSelected = list.length > 0 && list.every((n) => selectedIds.includes(n.id));

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const renderInboxContent = (tab: 'all' | 'unread' | 'read') => (
    <>
      <SearchToolbar>
        {selectedIds.length > 0 && tab !== 'read' && (
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
        {tab !== 'read' && (
          <Button
            type="primary"
            icon={<CheckCheck size={14} />}
            loading={markAllLoading}
            onClick={handleMarkAllRead}
          >
            全部标记为已读
          </Button>
        )}
        <RefreshButton onClick={() => void listQuery.refetch()} loading={loading} />
      </SearchToolbar>

      {list.length === 0 && !loading ? (
        <Empty
          image={<IllustrationIdle style={{ width: 120, height: 120 }} />}
          darkModeImage={<IllustrationIdleDark style={{ width: 120, height: 120 }} />}
          description={(() => {
            if (tab === 'unread') return '暂无未读站内信';
            if (tab === 'read') return '暂无已读站内信';
            return '暂无站内信';
          })()}
          style={{ padding: '48px 0' }}
        />
      ) : (
        <>
          <List
            size="small"
            loading={loading}
            dataSource={list}
            header={
              <Checkbox
                checked={allSelected}
                indeterminate={selectedIds.length > 0 && !allSelected}
                onChange={(e) => setSelectedIds(e.target.checked ? list.map((n) => n.id) : [])}
              >
                全选{selectedIds.length > 0 ? `（已选 ${selectedIds.length} 条）` : ''}
              </Checkbox>
            }
            renderItem={(item: InAppMessage, index: number) => (
              <List.Item
                key={item.id}
                style={{ cursor: 'pointer', opacity: item.isRead ? 0.7 : 1 }}
                onClick={() => void openMessage(item, index)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minWidth: 0 }}>
                  <span role="none" style={{ display: 'inline-flex', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(item.id)}
                      onChange={(e) => toggleSelect(item.id, Boolean(e.target.checked))}
                    />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {!item.isRead && <Badge dot style={{ flexShrink: 0 }} />}
                      <Text strong={!item.isRead} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.title}
                      </Text>
                      <Tag color={TYPE_COLOR[item.type] ?? 'blue'} size="small" style={{ flexShrink: 0 }}>
                        {TYPE_LABEL[item.type] ?? item.type}
                      </Tag>
                      <Text style={{ fontSize: 12, color: 'var(--semi-color-text-3)', marginLeft: 'auto', flexShrink: 0 }}>
                        {item.senderName ?? '系统'} · {formatDateTime(item.createdAt)}
                      </Text>
                    </div>
                    {item.content && (
                      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.content}
                      </div>
                    )}
                  </div>
                  <Popconfirm title="确定要删除吗？" onConfirm={() => void handleDelete(item.id)}>
                    <Button
                      theme="borderless"
                      type="danger"
                      size="small"
                      style={{ flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </List.Item>
            )}
          />
          <ListPagination
            pagination={{
              ...pagination,
              onPageChange: (p) => {
                pagination.onPageChange(p);
                setSelectedIds([]);
              },
              onPageSizeChange: (size) => {
                pagination.onPageSizeChange(size);
                setSelectedIds([]);
              },
            }}
          />
        </>
      )}
    </>
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={handleTabChange} type="line" lazyRender keepDOM={false}>
        <TabPane tab="全部" itemKey="all">
          {renderInboxContent('all')}
        </TabPane>
        <TabPane
          tab={
            <Space spacing={4}>
              <span>未读</span>
              {unreadCount > 0 && (
                <Tag color="red" size="small">{unreadCount}</Tag>
              )}
            </Space>
          }
          itemKey="unread"
        >
          {renderInboxContent('unread')}
        </TabPane>
        <TabPane tab="已读" itemKey="read">
          {renderInboxContent('read')}
        </TabPane>
      </Tabs>

      <AppModal
        title={selectedMessage?.title ?? ''}
        visible={selectedMessage !== null}
        onCancel={() => setSelected(null)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <Button
                icon={<ChevronLeft size={14} />}
                disabled={selectedIndex <= 0}
                onClick={handlePrev}
              >上一条</Button>
              <Button
                icon={<ChevronRight size={14} />}
                iconPosition="right"
                disabled={selectedIndex < 0 || selectedIndex >= list.length - 1}
                onClick={handleNext}
              >下一条</Button>
            </Space>
            <Space>
              {selectedIndex >= 0 && <Text type="tertiary" size="small">{`${selectedIndex + 1} / ${list.length}`}</Text>}
              <Button onClick={() => setSelected(null)}>关闭</Button>
            </Space>
          </div>
        }
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
