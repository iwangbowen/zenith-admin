import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  Button, Tag, Space, Tabs, TabPane, Toast, Empty, Badge, Modal, Popconfirm,
} from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { CheckCheck, Bell } from 'lucide-react';
import type { InAppMessage } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';

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
  const [list, setList] = useState<InAppMessage[]>([]);
  const [isPending, startTransition] = useTransition();
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read'>('all');
  const [markAllLoading, setMarkAllLoading] = useState(false);

  const [selected, setSelected] = useState<InAppMessage | null>(null);

  const fetchList = useCallback((p = 1, tab = activeTab) => {
    startTransition(async () => {
      const qs = new URLSearchParams({ page: String(p), pageSize: '10' });
      if (tab === 'unread') qs.set('isRead', 'false');
      else if (tab === 'read') qs.set('isRead', 'true');
      const res = await request.get<{ list: InAppMessage[]; total: number }>(
        `/api/in-app-messages?${qs.toString()}`,
      );
      if (res.code === 0 && res.data) {
        setList(res.data.list);
        setTotal(res.data.total);
        setPage(p);
      }
    });
  }, [activeTab]);

  useEffect(() => {
    fetchList(1, activeTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const openMessage = async (item: InAppMessage) => {
    if (!item.isRead) {
      await request.post(`/api/in-app-messages/${item.id}/read`, undefined, { silent: true });
      setList((prev) => prev.map((n) => n.id === item.id ? { ...n, isRead: true } : n));
    }
    setSelected({ ...item, isRead: true });
  };

  const handleMarkAllRead = async () => {
    setMarkAllLoading(true);
    const res = await request.post('/api/in-app-messages/read-all', {});
    setMarkAllLoading(false);
    if (res.code === 0) {
      Toast.success('已全部标记为已读');
      fetchList(1, activeTab);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/in-app-messages/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      fetchList(page, activeTab);
    }
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key as 'all' | 'unread' | 'read');
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
          <Button
            type="primary"
            icon={<CheckCheck size={14} />}
            loading={markAllLoading}
            onClick={handleMarkAllRead}
            style={{ visibility: activeTab === 'read' ? 'hidden' : 'visible' }}
          >
            全部标记为已读
          </Button>
        </div>

      {list.length === 0 && !isPending ? (
        <Empty
          image={<Bell size={48} strokeWidth={1} style={{ opacity: 0.3 }} />}
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
          pending={isPending}
          dataSource={list}
          rowKey="id"
          columns={columns}
          pagination={{
            total,
            currentPage: page,
            pageSize: 10,
            showSizeChanger: false,
            onPageChange: (p) => fetchList(p),
          }}
          onRow={(record) => ({
            style: { opacity: (record as InAppMessage).isRead ? 0.7 : 1 },
          })}
        />
      )}

      <Modal
        title={selected?.title ?? ''}
        visible={selected !== null}
        onCancel={() => setSelected(null)}
        footer={null}
        width={640}
        closeOnEsc
      >
        {selected && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--semi-color-text-3)', fontSize: 12 }}>
              {selected.senderName ?? '系统'} · {formatDateTime(selected.createdAt)}
            </div>
            <div style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {selected.content}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
