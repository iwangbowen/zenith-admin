import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Tag, Space, Tabs, TabPane, Modal, Typography, Toast, Empty, Badge,
} from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { CheckCheck, Bell } from 'lucide-react';
import type { Notice } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';

const { Text } = Typography;

type NoticeWithRead = Notice & { isRead: boolean };

const TYPE_LABEL: Record<string, string> = {
  notice: '通知',
  announcement: '公告',
  alert: '警告',
};

const PRIORITY_COLOR: Record<string, TagColor> = {
  low: 'cyan',
  medium: 'orange',
  high: 'red',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: '普通',
  medium: '重要',
  high: '紧急',
};

export default function NotificationsPage() {
  const [list, setList] = useState<NoticeWithRead[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [markAllLoading, setMarkAllLoading] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [selected, setSelected] = useState<NoticeWithRead | null>(null);

  const fetchList = useCallback(async (p = 1, tab = activeTab) => {
    setLoading(true);
    const isRead = tab === 'unread' ? 'false' : undefined;
    const qs = new URLSearchParams({ page: String(p), pageSize: '10' });
    if (isRead !== undefined) qs.set('isRead', isRead);
    const res = await request.get<{ list: NoticeWithRead[]; total: number }>(
      `/api/notices/inbox?${qs.toString()}`,
    );
    setLoading(false);
    if (res.code === 0 && res.data) {
      setList(res.data.list);
      setTotal(res.data.total);
      setPage(p);
    }
  }, [activeTab]);

  useEffect(() => {
    void fetchList(1, activeTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const markAsRead = async (item: NoticeWithRead) => {
    if (!item.isRead) {
      await request.post(`/api/notices/${item.id}/read`, undefined, { silent: true });
    }
    setSelected(item);
    setModalVisible(true);
    // optimistic update
    setList((prev) => prev.map((n) => n.id === item.id ? { ...n, isRead: true } : n));
  };

  const handleMarkAllRead = async () => {
    setMarkAllLoading(true);
    const res = await request.post('/api/notices/read-all', {});
    setMarkAllLoading(false);
    if (res.code === 0) {
      Toast.success('已全部标记为已读');
      void fetchList(1, activeTab);
    }
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key as 'all' | 'unread');
    setPage(1);
  };

  const unreadCount = list.filter((n) => !n.isRead).length;

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string, record: NoticeWithRead) => (
        <Button
          theme="borderless"
          size="small"
          style={{ fontWeight: record.isRead ? 400 : 600, padding: 0 }}
          onClick={() => void markAsRead(record)}
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
      render: (v: string) => <Tag size="small">{TYPE_LABEL[v] ?? v}</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (v: string) => (
        <Tag color={PRIORITY_COLOR[v] ?? 'blue'} size="small">
          {PRIORITY_LABEL[v] ?? v}
        </Tag>
      ),
    },
    {
      title: '发布时间',
      dataIndex: 'publishTime',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'isRead',
      width: 80,
      render: (v: boolean) => (
        <Tag color={v ? 'grey' : 'blue'} size="small">
          {v ? '已读' : '未读'}
        </Tag>
      ),
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: NoticeWithRead) => (
        <Button
          theme="borderless"
          size="small"
          onClick={() => void markAsRead(record)}
        >
          查看
        </Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="search-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tabs activeKey={activeTab} onChange={handleTabChange} style={{ marginBottom: 0 }}>
            <TabPane tab="全部通知" itemKey="all" />
            <TabPane
              tab={
                <Space spacing={4}>
                  <span>未读消息</span>
                  {activeTab === 'all' && unreadCount > 0 && (
                    <Tag color="red" size="small">{unreadCount}</Tag>
                  )}
                </Space>
              }
              itemKey="unread"
            />
          </Tabs>
          <Button
            type="secondary"
            icon={<CheckCheck size={14} />}
            loading={markAllLoading}
            onClick={handleMarkAllRead}
          >
            全部标记为已读
          </Button>
        </div>
      </div>

      {list.length === 0 && !loading ? (
        <Empty
          image={<Bell size={48} strokeWidth={1} style={{ opacity: 0.3 }} />}
          description={activeTab === 'unread' ? '暂无未读通知' : '暂无通知'}
          style={{ padding: '48px 0' }}
        />
      ) : (
        <Table
          bordered
          loading={loading}
          dataSource={list}
          rowKey="id"
          columns={columns}
          pagination={{
            total,
            currentPage: page,
            pageSize: 10,
            showSizeChanger: false,
            onPageChange: (p) => void fetchList(p),
          }}
          onRow={(record) => ({
            style: { opacity: (record as NoticeWithRead).isRead ? 0.7 : 1 },
          })}
        />
      )}

      <Modal
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        width={560}
        title={selected?.title ?? ''}
        footer={null}
        closeOnEsc
      >
        {selected && (
          <div>
            <Space wrap style={{ marginBottom: 16 }}>
              <Tag size="small">{TYPE_LABEL[selected.type] ?? selected.type}</Tag>
              <Tag color={PRIORITY_COLOR[selected.priority] ?? 'blue'} size="small">
                {PRIORITY_LABEL[selected.priority] ?? selected.priority}
              </Tag>
              <Text type="tertiary" size="small">
                {formatDateTime(selected.publishTime ?? selected.createdAt)}
              </Text>
            </Space>
            <div
              style={{ lineHeight: 1.8, color: 'var(--semi-color-text-0)' }}
              dangerouslySetInnerHTML={{ __html: selected.content }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
