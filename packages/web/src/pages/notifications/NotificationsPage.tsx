import { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import {
  Button, Tag, Space, Tabs, TabPane, Modal, Typography, Toast, Empty, Badge, Divider,
} from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { CheckCheck, Bell, Clock, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Notice } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';

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
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read'>('all');
  const [markAllLoading, setMarkAllLoading] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [selected, setSelected] = useState<NoticeWithRead | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const fetchList = useCallback(async (p = 1, tab = activeTab) => {
    setLoading(true);
    let isRead: string | undefined;
    if (tab === 'unread') isRead = 'false';
    else if (tab === 'read') isRead = 'true';
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

  const openNotice = async (item: NoticeWithRead, index: number) => {
    if (!item.isRead) {
      await request.post(`/api/notices/${item.id}/read`, undefined, { silent: true });
    }
    setSelected({ ...item, isRead: true });
    setSelectedIndex(index);
    setModalVisible(true);
    // optimistic update
    setList((prev) => prev.map((n) => n.id === item.id ? { ...n, isRead: true } : n));
  };

  const handlePrev = () => {
    if (selectedIndex > 0) void openNotice(list[selectedIndex - 1], selectedIndex - 1);
  };

  const handleNext = () => {
    if (selectedIndex < list.length - 1) void openNotice(list[selectedIndex + 1], selectedIndex + 1);
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
    setActiveTab(key as 'all' | 'unread' | 'read');
    setPage(1);
  };

  const unreadCount = list.filter((n) => !n.isRead).length;

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string, record: NoticeWithRead, index: number) => (
        <Button
          theme="borderless"
          size="small"
          style={{ fontWeight: record.isRead ? 400 : 600, padding: 0 }}
          onClick={() => void openNotice(record, index)}
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
      render: (_: unknown, record: NoticeWithRead, index: number) => (
        <Button
          theme="borderless"
          size="small"
          onClick={() => void openNotice(record, index)}
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
            <TabPane tab="已读消息" itemKey="read" />
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
      </div>

      {list.length === 0 && !loading ? (
        <Empty
          image={<Bell size={48} strokeWidth={1} style={{ opacity: 0.3 }} />}
          description={(() => {
            if (activeTab === 'unread') return '暂无未读通知';
            if (activeTab === 'read') return '暂无已读通知';
            return '暂无通知';
          })()}
          style={{ padding: '48px 0' }}
        />
      ) : (
        <ConfigurableTable
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
        width={600}
        title={
          <Space spacing={8}>
            <BookOpen size={16} strokeWidth={1.5} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />
            <span>{selected?.title ?? ''}</span>
          </Space>
        }
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
                disabled={selectedIndex >= list.length - 1}
                onClick={handleNext}
              >下一条</Button>
            </Space>
            <Space>
              <Text type="tertiary" size="small">{selectedIndex + 1} / {list.length}</Text>
              <Button onClick={() => setModalVisible(false)}>关闭</Button>
            </Space>
          </div>
        }
        closeOnEsc
      >
        {selected && (
          <div>
            {/* 元信息区 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: '1px solid var(--semi-color-border)',
            }}>
              <Tag size="small" color="blue">{TYPE_LABEL[selected.type] ?? selected.type}</Tag>
              <Tag color={PRIORITY_COLOR[selected.priority] ?? 'blue'} size="small">
                {PRIORITY_LABEL[selected.priority] ?? selected.priority}
              </Tag>
              <Divider layout="vertical" style={{ height: 12, margin: '0 2px' }} />
              <Space spacing={4}>
                <Clock size={12} strokeWidth={1.5} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
                <Text type="tertiary" size="small">
                  {formatDateTime(selected.publishTime ?? selected.createdAt)}
                </Text>
              </Space>
              <div style={{ marginLeft: 'auto' }}>
                <Tag color={selected.isRead ? 'grey' : 'blue'} size="small">
                  {selected.isRead ? '已读' : '未读'}
                </Tag>
              </div>
            </div>
            {/* 正文区 */}
            <div
              style={{
                lineHeight: 1.9,
                color: 'var(--semi-color-text-0)',
                minHeight: 80,
                fontSize: 14,
                padding: '0 2px',
              }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selected.content) }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
